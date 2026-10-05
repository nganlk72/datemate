import { GoogleGenAI, Type } from '@google/genai';
import { reverseGeocodeRaw } from './vietmap';

// ─── Model constants ───────────────────────────────────────────────────────────
// Override either via .env.local to swap models without touching code.
// gemini-3.8-flash is a thinking model; response.text auto-skips thought parts.
const GEMINI_MODEL          = import.meta.env.VITE_GEMINI_MODEL          || 'gemini-3.8-flash';
const GEMINI_FALLBACK_MODEL = import.meta.env.VITE_GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash';

const ai = new GoogleGenAI({
  apiKey: import.meta.env.VITE_GEMINI_API_KEY
});

// ─── Retry helper ─────────────────────────────────────────────────────────────
// Delays for retries: 1 s after the 1st failure, 2 s after the 2nd failure.
const RETRY_DELAYS_MS = [1000, 2000];

/**
 * Returns true for transient errors that are safe to retry (503 / 429).
 * Does NOT include 404 — that is handled separately by isModelNotFound().
 */
function isRetryable(error) {
  // The SDK exposes error.status as an HTTP status number on some errors.
  if (typeof error.status === 'number') {
    return error.status === 503 || error.status === 429;
  }
  // Fall back to inspecting the message string for the gRPC status names.
  const msg = (error.message || '').toUpperCase();
  return msg.includes('UNAVAILABLE') || msg.includes('RESOURCE_EXHAUSTED');
}

/**
 * Returns true when the model name itself is unknown or retired (HTTP 404 / NOT_FOUND).
 * In that case we skip retries entirely and switch to the fallback model immediately.
 * Other permanent errors (400 bad request, 401 unauthenticated, 403 forbidden)
 * are NOT matched here — they are re-thrown immediately with no model switch.
 */
function isModelNotFound(error) {
  if (typeof error.status === 'number') {
    return error.status === 404;
  }
  const msg = (error.message || '').toUpperCase();
  return msg.includes('NOT_FOUND');
}

/**
 * Calls ai.models.generateContent with automatic retry on transient errors,
 * immediate fallback on 404 (retired/unknown model), and one fallback model
 * attempt after exhausting retries.
 *
 * Error taxonomy:
 *   503 / UNAVAILABLE       → retry up to 2×, then fallback model
 *   429 / RESOURCE_EXHAUSTED → retry up to 2×, then fallback model
 *   404 / NOT_FOUND          → skip retries, jump to fallback model immediately
 *   400 / 401 / 403          → throw immediately, no retry, no model switch
 *
 * @param {object} params - The full generateContent parameter object (must include `model`).
 * @returns {Promise<object>} The SDK response object.
 */
async function callWithRetry(params) {
  const primaryModel  = params.model;
  const fallbackModel = GEMINI_FALLBACK_MODEL;

  let lastError;
  let skipToFallback = false;

  // ── Primary model: up to 1 initial attempt + 2 retries ──────────────────────
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const delayMs = RETRY_DELAYS_MS[attempt - 1];
      console.warn(
        `[Gemini] Attempt ${attempt + 1}: retrying primary model "${primaryModel}" ` +
        `in ${delayMs / 1000}s (error: ${lastError?.message})`
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      lastError = err;
      if (isModelNotFound(err)) {
        // Model is retired or unknown — no point retrying, go straight to fallback.
        console.warn(
          `[Gemini] Primary model "${primaryModel}" returned 404 (NOT_FOUND). ` +
          `Switching to fallback model "${fallbackModel}" immediately.`
        );
        skipToFallback = true;
        break;
      }
      if (!isRetryable(err)) {
        // Permanent error (400, 401, 403…) — fail fast, no model switch.
        throw err;
      }
    }
  }

  // ── Fallback model: one attempt only ─────────────────────────────────────────
  if (!skipToFallback) {
    console.warn(
      `[Gemini] Primary model "${primaryModel}" exhausted retries. ` +
      `Trying fallback model "${fallbackModel}"…`
    );
  }
  try {
    return await ai.models.generateContent({ ...params, model: fallbackModel });
  } catch (err) {
    console.error(
      `[Gemini] Fallback model "${fallbackModel}" also failed:`, err.message
    );
    throw err; // Let the caller's own catch / non-AI fallback handle it.
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function extractTripParameters(promptText) {
  try {
    const response = await callWithRetry({
      model: GEMINI_MODEL,
      contents: `You are an AI travel assistant. Extract the parameters from the user's trip request. 
      If a parameter is not explicitly mentioned, infer a reasonable default or leave it empty.
      
      User Request: "${promptText}"`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            headcount: { type: Type.INTEGER, description: "Number of people. Default to 1 if unknown." },
            budget: { type: Type.INTEGER, description: "Total budget per person in VND (e.g. 300000)" },
            city: { type: Type.STRING, description: "The city they want to visit (e.g., 'Hanoi')" },
            categories: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Array of location categories (e.g., 'cafe', 'restaurant', 'attraction', 'bar', 'park')"
            }
          },
          required: ["headcount", "city", "categories"]
        }
      }
    });

    const jsonText = response.text;
    return JSON.parse(jsonText);
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    throw error;
  }
}

export async function generateCompromiseItinerary(participants) {
  // --- Aggregation Engine ---
  const budgets = participants.map(p => p.budget).filter(Boolean);
  const lowestBudget = budgets.length > 0 ? Math.min(...budgets) : 300000;

  const allActivities = [
    ...new Set(
      participants.flatMap(p => {
        const prefs = p.preferences;
        if (Array.isArray(prefs)) return prefs;
        if (prefs?.activities) return prefs.activities;
        return [];
      })
    )
  ].filter(Boolean);

  // Centroid for search center (not the meetup point — just for finding nearby places)
  const lats = participants.map(p => p.start_lat).filter(Boolean);
  const lons = participants.map(p => p.start_lon).filter(Boolean);
  const centroidLat = lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : 21.0285;
  const centroidLon = lons.length > 0 ? lons.reduce((a, b) => a + b, 0) / lons.length : 105.8542;

  // --- Derive city from reverseGeocode (deterministic — 1 API call, no hallucination) ---
  // Primary: boundaries[type===0].name (e.g. "Hà Nội")
  // Fallback 1: last comma-segment of the display address string
  // Fallback 2: hardcoded "Hanoi" (applied later in the return statements)
  let geoCity = null;
  try {
    const rawItem = await reverseGeocodeRaw(centroidLat, centroidLon);
    if (rawItem?.boundaries) {
      const cityBoundary = rawItem.boundaries.find(b => b.type === 0);
      if (cityBoundary?.name) geoCity = cityBoundary.name;
    }
    if (!geoCity && rawItem?.display) {
      const parts = rawItem.display.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length > 0) geoCity = parts[parts.length - 1];
    }
  } catch (err) {
    console.warn('[generateCompromiseItinerary] reverseGeocode failed:', err.message);
  }

  // Gemini only needs to pick categories — city comes from reverseGeocode above.
  const prompt = `You are a group travel planner. A group of ${participants.length} friends want to hang out together.

Group constraints:
- Lowest budget per person: ${lowestBudget.toLocaleString()} VND
- Combined activity wishes: ${allActivities.join(', ') || 'general sightseeing'}
- Group size: ${participants.length} people

Your job: Return a list of 4-6 category keywords that best satisfy this group (e.g. 'cafe', 'restaurant', 'attraction', 'bar', 'park', 'museum').
Prioritize categories that appear multiple times in their wishes.`;

  try {
    const response = await callWithRetry({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            categories: { type: Type.ARRAY, items: { type: Type.STRING } },
            itinerary_description: { type: Type.STRING }
          },
          required: ["categories"]
        }
      }
    });

    const result = JSON.parse(response.text);
    return {
      ...result,
      city: geoCity || 'Hanoi',
      lowestBudget,
      headcount: participants.length,
      centroidLat,
      centroidLon,
    };
  } catch (error) {
    console.warn("Gemini failed, using fallback:", error.message);
    // Non-AI fallback — used when both primary + fallback model fail
    return {
      city: geoCity || 'Hanoi',
      categories: allActivities.length > 0 ? allActivities : ["cafe", "attraction"],
      lowestBudget,
      headcount: participants.length,
      centroidLat,
      centroidLon,
      itinerary_description: "A group compromise trip"
    };
  }
}


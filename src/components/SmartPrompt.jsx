import { useState, useRef, useEffect } from 'react';
import { extractTripParameters } from '../lib/ai';
import { fetchVietmapPoi } from '../lib/vietmapPoi';
import { searchAddress, geocodeRef } from '../lib/vietmap';
import { Wand2, Loader2 } from 'lucide-react';

const GEMINI_TIMEOUT_MS = 20000;
const VIETMAP_TIMEOUT_MS = 20000;

/**
 * Module-level cache: lowercased city name → { lat, lon } | null
 * Persists across re-renders; resets on full page reload.
 * Prevents repeated Autocomplete + Place v4 calls for the same city name.
 */
const _cityGeoCache = new Map();

/**
 * Resolves a city name to map coordinates via Vietmap Autocomplete v4 + Place v4.
 * Returns { lat, lon } on success, null if no results or geocode fails.
 * API cost: 1 Autocomplete call + 1 Place call (both skipped on cache hit).
 */
async function geocodeCityCenter(cityName, signal) {
  const key = cityName.toLowerCase();
  if (_cityGeoCache.has(key)) return _cityGeoCache.get(key);
  const items = await searchAddress(cityName, null, null, null, signal);
  if (!items.length || !items[0].ref_id) {
    _cityGeoCache.set(key, null);
    return null;
  }
  const coords = await geocodeRef(items[0].ref_id, signal);
  const result = coords ? { lat: coords.lat, lon: coords.lon } : null;
  _cityGeoCache.set(key, result);
  return result;
}

export default function SmartPrompt({ onLocationsDiscovered }) {
  const [prompt, setPrompt] = useState('5 of us wanting to hang out in Hanoi on Saturday afternoon, around 300k VND, food and sightseeing.');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('');

  const abortControllerRef = useRef(null);

  // Clean up any pending Vietmap requests on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleGenerate = async () => {
    if (!prompt) return;

    // A new AbortController must be created at the START of every handleGenerate run.
    if (abortControllerRef.current) {
      abortControllerRef.current.abort(); // abort any previous run still going
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setIsProcessing(true);
    setStatusText('Thinking (Extracting parameters)...');
    
    let hasError = false; // Used to prevent finally{} from erasing error messages

    try {
      // ── Stage 1: Gemini parameter extraction (own budget) ──────────────
      let geminiTimer;
      const geminiTimeout = new Promise((_, reject) =>
        geminiTimer = setTimeout(() => reject(new Error("TIMEOUT")), GEMINI_TIMEOUT_MS)
      );

      const geminiPromise = extractTripParameters(prompt);
      geminiPromise.catch(() => {}); // Prevent unhandled rejection if timeout wins

      let params;
      try {
        params = await Promise.race([
          geminiPromise,
          geminiTimeout
        ]);
        clearTimeout(geminiTimer);
      } catch (err) {
        clearTimeout(geminiTimer);
        console.warn("AI extraction failed or timed out. Using fallback parameters. Error:", err.message);
        params = { headcount: 5, budget: 300000, city: "Hanoi", categories: ["attraction", "cafe"] };
      }

      if (!params.city) {
        setStatusText("Couldn't determine the city from your prompt. Please include a city name.");
        setIsProcessing(false);
        hasError = true;
        return;
      }

      setStatusText(`Searching Vietmap for ${params.categories.join(', ')} in ${params.city}...`);

      // ── Stage 2: Vietmap geocode + POI search (fresh budget) ──────────
      let vietmapTimer;
      const vietmapTimeout = new Promise((_, reject) =>
        vietmapTimer = setTimeout(() => {
          abortControllerRef.current?.abort();
          reject(new Error("VIETMAP_TIMEOUT"));
        }, VIETMAP_TIMEOUT_MS)
      );

      const vietmapPromise = (async () => {
        let cityCenter = null;
        try {
          cityCenter = await geocodeCityCenter(params.city, signal);
          if (!cityCenter) {
            console.warn(
              `[SmartPrompt] Could not geocode city "${params.city}". ` +
              `Falling back to focus-only search (no circle constraint).`
            );
          }
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          console.warn(`[SmartPrompt] City geocode error for "${params.city}":`, err.message);
        }
        return fetchVietmapPoi(
          params.city,
          params.categories,
          cityCenter?.lat ?? null,
          cityCenter?.lon ?? null,
          cityCenter ? 5000 : null,
          signal
        );
      })();
      vietmapPromise.catch(() => {}); // Prevent unhandled rejection if aborted

      let places;
      try {
        places = await Promise.race([
          vietmapPromise,
          vietmapTimeout
        ]);
        clearTimeout(vietmapTimer);
      } catch (err) {
        clearTimeout(vietmapTimer);
        
        const timedOut = err.message === "VIETMAP_TIMEOUT";
        
        // Match variations like "Hanoi", "Hà Nội", "Ha Noi", "Hanoi, Vietnam", "Hà Nội, Việt Nam"
        const normCity = params.city.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const isHanoi = /^(ha noi|hanoi)(, (viet nam|vietnam))?$/.test(normCity);

        if (isHanoi) {
          console.warn(
            timedOut
              ? "Vietmap POI search timed out after 20 s. Using fallback locations."
              : `Vietmap POI search failed: ${err.message}. Using fallback locations.`
          );
          if (timedOut) {
            setStatusText('⏱ Vietmap search timed out — using nearby defaults.');
            await new Promise(r => setTimeout(r, 2000));
          }
          // Fallback places in Hanoi
          places = [
            { name: "Hoan Kiem Lake", lat: 21.0289, lon: 105.8522, category: "attraction" },
            { name: "Temple of Literature", lat: 21.0294, lon: 105.8355, category: "attraction" },
            { name: "St. Joseph's Cathedral", lat: 21.0287, lon: 105.8489, category: "attraction" },
            { name: "Dong Xuan Market", lat: 21.0379, lon: 105.8509, category: "market" }
          ];
        } else {
          // If the target city was NOT Hanoi, do not silently fallback to Hanoi.
          // Keep the prompt in the text box so they can retry.
          const msg = timedOut
            ? "⏱ Vietmap search timed out. Please try again."
            : `❌ Vietmap search failed: ${err.message}. Please try again.`;
          setStatusText(msg);
          setIsProcessing(false);
          hasError = true;
          return;
        }
      }
      onLocationsDiscovered(places, params);
      setStatusText('Done!');
    } catch (error) {
      console.error(error);
      setStatusText('❌ Error processing prompt. Check console for details.');
      setIsProcessing(false);
      hasError = true;
    } finally {
      setIsProcessing(false);
      // Only clear the status text automatically if there wasn't an error,
      // so the user actually has time to read error messages.
      if (!hasError) {
        setTimeout(() => setStatusText(''), 3000);
      }
    }
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-md border border-purple-200 mb-4">
      <h3 className="font-bold mb-2 flex items-center text-purple-700">
        <Wand2 className="mr-2" size={18} /> Smart AI Planner
      </h3>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-purple-400 focus:outline-none resize-none"
        rows="3"
        placeholder="Describe your ideal trip... (e.g. 5 of us in Hanoi looking for cafes and museums)"
      />
      <button
        onClick={handleGenerate}
        disabled={isProcessing}
        className="w-full mt-2 bg-purple-600 hover:bg-purple-700 text-white py-2 rounded font-bold flex justify-center items-center disabled:opacity-50"
      >
        {isProcessing ? (
          <><Loader2 className="animate-spin mr-2" size={16} /> {statusText}</>
        ) : (
          'Generate Magic Itinerary'
        )}
      </button>
    </div>
  );
}

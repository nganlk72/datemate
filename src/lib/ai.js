import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ 
  apiKey: import.meta.env.VITE_GEMINI_API_KEY 
});

export async function extractTripParameters(promptText) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
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

  // Centroid for Overpass search center (not used as meetup, just for finding nearby places)
  const lats = participants.map(p => p.start_lat).filter(Boolean);
  const lons = participants.map(p => p.start_lon).filter(Boolean);
  const centroidLat = lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : 21.0285;
  const centroidLon = lons.length > 0 ? lons.reduce((a, b) => a + b, 0) / lons.length : 105.8542;

  const prompt = `You are a group travel planner. A group of ${participants.length} friends want to hang out together.
  
Group constraints:
- Lowest budget per person: ${lowestBudget.toLocaleString()} VND
- Combined activity wishes: ${allActivities.join(', ') || 'general sightseeing'}
- Group size: ${participants.length} people

Your job: Decide what city/area they are in and return a list of 4-6 category keywords that best satisfy this group (e.g. 'cafe', 'restaurant', 'attraction', 'bar', 'park', 'museum').
Prioritize categories that appear multiple times in their wishes.
Return the city name as a short string (e.g., "Hanoi", "Ho Chi Minh City").`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            city: { type: Type.STRING },
            categories: { type: Type.ARRAY, items: { type: Type.STRING } },
            itinerary_description: { type: Type.STRING }
          },
          required: ["city", "categories"]
        }
      }
    });

    const result = JSON.parse(response.text);
    return {
      ...result,
      lowestBudget,
      headcount: participants.length,
      centroidLat,
      centroidLon
    };
  } catch (error) {
    console.warn("Gemini failed, using fallback:", error.message);
    // Fallback if AI fails
    return {
      city: "Hanoi",
      categories: allActivities.length > 0 ? allActivities : ["cafe", "attraction"],
      lowestBudget,
      headcount: participants.length,
      centroidLat,
      centroidLon,
      itinerary_description: "A group compromise trip"
    };
  }
}

import { useState } from 'react';
import { extractTripParameters } from '../lib/ai';
import { fetchLocationsFromOverpass } from '../lib/overpass';
import { Wand2, Loader2 } from 'lucide-react';

export default function SmartPrompt({ onLocationsDiscovered }) {
  const [prompt, setPrompt] = useState('5 of us wanting to hang out in Hanoi on Saturday afternoon, around 300k VND, food and sightseeing.');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('');

  const handleGenerate = async () => {
    if (!prompt) return;
    setIsProcessing(true);
    setStatusText('Thinking (Extracting parameters)...');
    
    try {
      // 10-second timeout mechanism
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("TIMEOUT")), 10000)
      );

      let params;
      try {
        params = await Promise.race([
          extractTripParameters(prompt),
          timeoutPromise
        ]);
      } catch (err) {
        console.warn("AI extraction failed or timed out. Using fallback parameters. Error:", err.message);
        params = { headcount: 5, budget: 300000, city: "Hanoi", categories: ["attraction", "cafe"] };
      }

      if (!params.city) {
        alert("Couldn't determine the city from your prompt. Please include a city name.");
        setIsProcessing(false);
        return;
      }

      setStatusText(`Searching Vietmap for ${params.categories.join(', ')} in ${params.city}...`);
      
      let places;
      try {
        places = await Promise.race([
          fetchLocationsFromOverpass(params.city, params.categories, params.centroidLat, params.centroidLon),
          timeoutPromise
        ]);
      } catch (err) {
        console.warn("Vietmap POI search failed or timed out. Using fallback locations. Error:", err.message);
        // Fallback places in Hanoi — no osm_id needed
        places = [
          { name: "Hoan Kiem Lake", lat: 21.0289, lon: 105.8522, category: "attraction" },
          { name: "Temple of Literature", lat: 21.0294, lon: 105.8355, category: "attraction" },
          { name: "St. Joseph's Cathedral", lat: 21.0287, lon: 105.8489, category: "attraction" },
          { name: "Dong Xuan Market", lat: 21.0379, lon: 105.8509, category: "market" }
        ];
      }
      
      console.log('Discovered Places:', places);
      onLocationsDiscovered(places, params);
      setStatusText('Done!');
    } catch (error) {
      console.error(error);
      alert('Error processing prompt. Check console for details.');
    } finally {
      setIsProcessing(false);
      setTimeout(() => setStatusText(''), 3000);
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

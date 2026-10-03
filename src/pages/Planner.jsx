import { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import ItineraryForm from '../components/ItineraryForm';
import MapContainer from '../components/MapContainer';
import RouteOptions from '../components/RouteOptions';
import SmartPrompt from '../components/SmartPrompt';
import { createEmptyTrip } from '../lib/db';
import { Users, Loader2, Sparkles, Hand } from 'lucide-react';
import { getRoute } from '../lib/vietmap';

export default function Planner() {
  const navigate = useNavigate();
  const [locations, setLocations] = useState([]);
  const [travelMode, setTravelMode] = useState('car');
  const [routes, setRoutes] = useState([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [isCalculating, setIsCalculating] = useState(false);
  const [tripParams, setTripParams] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoMode, setIsAutoMode] = useState(true);

  const handleLocationsDiscovered = (discoveredPlaces, params) => {
    const mappedLocations = discoveredPlaces.map((place) => ({
      id: place.osm_id.toString(),
      osm_id: place.osm_id,
      name: place.name,
      displayName: place.name,
      lat: place.lat,
      lon: place.lon,
      category: place.category
    }));
    
    setLocations(mappedLocations.slice(0, 5));
    setTripParams(params);
  };

  const handleCalculateRoute = async () => {
    if (locations.length < 2) return;
    setIsCalculating(true);
    setRoutes([]);
    setSelectedRouteIndex(0);

    try {
      const path = await getRoute(locations, travelMode);
      if (path) {
        // Wrap the path inside an array to mimic the old routes format for `RouteOptions`
        setRoutes([path]);
      } else {
        alert("Vietmap could not find a valid route between these locations.");
      }
    } catch (error) {
      console.error("Error calculating route:", error);
      alert("Failed to calculate route.");
    } finally {
      setIsCalculating(false);
    }
  };

  const handleCreateLobby = async () => {
    setIsSaving(true);
    try {
      const tripId = await createEmptyTrip();
      localStorage.setItem(`host_${tripId}`, 'true');
      navigate(`/room/${tripId}`);
    } catch (error) {
      console.error("Failed to save trip:", error);
      alert("Failed to create the group trip. Check Supabase connection.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-screen w-full font-sans text-gray-800">
      <div className="w-1/3 min-w-[350px] max-w-[450px] h-full flex flex-col p-4 shadow-lg z-10 bg-gray-50 border-r overflow-y-auto">
        
        {/* Toggle Switch */}
        <div className="flex bg-gray-200 rounded-lg p-1 mb-6 shadow-inner">
          <button 
            onClick={() => setIsAutoMode(true)} 
            className={`flex-1 flex items-center justify-center py-2 rounded-md font-bold text-sm transition ${isAutoMode ? 'bg-white shadow text-purple-700' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Sparkles size={16} className="mr-2" /> Auto-Magic
          </button>
          <button 
            onClick={() => setIsAutoMode(false)}
            className={`flex-1 flex items-center justify-center py-2 rounded-md font-bold text-sm transition ${!isAutoMode ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Hand size={16} className="mr-2" /> Manual Builder
          </button>
        </div>

        {isAutoMode ? (
          <div className="flex-1 flex flex-col justify-center items-center text-center p-4 animate-fade-in-up">
            <div className="w-24 h-24 bg-purple-100 rounded-full flex items-center justify-center mb-6">
              <Users size={48} className="text-purple-600" />
            </div>
            <h2 className="text-2xl font-bold mb-2 text-gray-800">Stop guessing.</h2>
            <p className="text-gray-600 mb-8">
              Create a group lobby, invite your friends, and let everyone submit their budget and preferences. 
              Our AI will instantly calculate the perfect compromise itinerary for the whole group.
            </p>
            <button 
              onClick={handleCreateLobby}
              disabled={isSaving}
              className="w-full bg-purple-600 text-white font-bold py-4 rounded-xl hover:bg-purple-700 flex justify-center items-center shadow-lg transition transform hover:-translate-y-1"
            >
              {isSaving ? <Loader2 className="animate-spin mr-2" size={24} /> : <Sparkles className="mr-2" size={24} />}
              {isSaving ? 'Creating Lobby...' : 'Start Group Lobby'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col flex-1 animate-fade-in-up">
            <SmartPrompt onLocationsDiscovered={handleLocationsDiscovered} />
            
            {tripParams && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
                <strong>Found pool of {locations.length} places for:</strong> <br/>
                Budget: {tripParams.budget ? `${tripParams.budget} VND` : 'Unspecified'} | City: {tripParams.city}
              </div>
            )}

            <ItineraryForm 
              locations={locations}
              setLocations={setLocations}
              travelMode={travelMode}
              setTravelMode={setTravelMode}
              onCalculateRoute={handleCalculateRoute}
              isCalculating={isCalculating}
            />
            
            {routes.length > 0 && (
              <RouteOptions 
                routes={routes} 
                selectedRouteIndex={selectedRouteIndex}
                setSelectedRouteIndex={setSelectedRouteIndex}
              />
            )}
          </div>
        )}
      </div>

      <div className="flex-1 relative bg-gray-200 h-full">
        <MapContainer 
          locations={!isAutoMode ? locations : []}
          routeGeometry={!isAutoMode ? routes[selectedRouteIndex]?.geometry : null}
        />
      </div>
    </div>
  );
}

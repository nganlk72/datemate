import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import MapContainer from '../components/MapContainer';
import { ThumbsUp, MapPin, Copy, Check, X } from 'lucide-react';

export default function VotingRoom() {
  const { id } = useParams();
  const [trip, setTrip] = useState(null);
  const [locations, setLocations] = useState([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchTripData();

    // Subscribe to realtime updates for this specific trip's votes
    const channel = supabase
      .channel(`trip_${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'trip_locations',
          filter: `trip_id=eq.${id}`
        },
        (payload) => {
          // Update the vote count in state instantly
          setLocations(currentLocations => 
            currentLocations.map(loc => 
              loc.location_id === payload.new.location_id 
                ? { ...loc, votes: payload.new.votes }
                : loc
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  const fetchTripData = async () => {
    // 1. Fetch Trip Details
    const { data: tripData } = await supabase
      .from('trips')
      .select('*')
      .eq('id', id)
      .single();
    
    if (tripData) setTrip(tripData);

    // 2. Fetch associated locations and their votes
    const { data: locData } = await supabase
      .from('trip_locations')
      .select(`
        votes,
        location_id,
        locations ( osm_id, name, lat, lon, category )
      `)
      .eq('trip_id', id);

    if (locData) {
      const formattedLocs = locData.map(item => ({
        id: item.location_id,
        location_id: item.location_id,
        votes: item.votes,
        ...item.locations,
        displayName: item.locations.name
      }));
      // Sort by most votes
      formattedLocs.sort((a, b) => b.votes - a.votes);
      setLocations(formattedLocs);
    }
  };

  const handleVote = async (locationId, currentVotes) => {
    // Optimistic UI update
    setLocations(current => 
      current.map(loc => loc.location_id === locationId ? { ...loc, votes: currentVotes + 1 } : loc)
    );

    // Update Supabase
    await supabase
      .from('trip_locations')
      .update({ votes: currentVotes + 1 })
      .match({ trip_id: id, location_id: locationId });
  };

  const handleRemoveLocation = async (locationId) => {
    // Optimistic UI update
    setLocations(current => current.filter(loc => loc.location_id !== locationId));
    
    // Update Supabase
    await supabase
      .from('trip_locations')
      .delete()
      .match({ trip_id: id, location_id: locationId });
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!trip) return <div className="p-10 text-center">Loading Room...</div>;

  return (
    <div className="flex h-screen w-full font-sans text-gray-800">
      {/* Sidebar */}
      <div className="w-1/3 min-w-[350px] max-w-[450px] h-full flex flex-col shadow-lg z-10 bg-white border-r overflow-y-auto">
        <div className="p-6 border-b bg-indigo-50">
          <h1 className="text-2xl font-bold text-indigo-900">{trip.title}</h1>
          <p className="text-sm text-indigo-700 mt-1">
            Group of {trip.headcount} • Budget: {trip.budget ? `${trip.budget} VND` : 'TBD'}
          </p>
          <button 
            onClick={copyLink}
            className="mt-4 flex items-center justify-center w-full bg-white border border-indigo-200 text-indigo-600 py-2 rounded hover:bg-indigo-100 transition"
          >
            {copied ? <Check size={18} className="mr-2" /> : <Copy size={18} className="mr-2" />}
            {copied ? 'Link Copied!' : 'Copy Invite Link'}
          </button>
        </div>

        <div className="p-4 flex-1">
          <h2 className="font-bold text-gray-700 mb-4">Vote on Locations</h2>
          <div className="space-y-3">
            {locations.map((loc, index) => (
              <div key={loc.id} className="p-3 border rounded-lg shadow-sm flex items-center justify-between bg-white hover:border-indigo-300 transition relative group">
                <button 
                  onClick={() => handleRemoveLocation(loc.location_id)}
                  className="absolute -top-2 -left-2 bg-white border shadow-sm rounded-full p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove location"
                >
                  <X size={14} />
                </button>
                <div className="flex-1 pr-4 ml-1">
                  <h3 className="font-bold flex items-center">
                    <span className="bg-indigo-100 text-indigo-800 w-5 h-5 rounded-full flex items-center justify-center text-xs mr-2">
                      {index + 1}
                    </span>
                    {loc.name}
                  </h3>
                  <p className="text-xs text-gray-500 mt-1 capitalize">{loc.category}</p>
                </div>
                <button 
                  onClick={() => handleVote(loc.location_id, loc.votes)}
                  className="flex flex-col items-center justify-center bg-gray-50 hover:bg-indigo-50 border p-2 rounded w-16"
                >
                  <ThumbsUp size={18} className="text-indigo-600 mb-1" />
                  <span className="font-bold text-sm text-indigo-900">{loc.votes}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Map */}
      <div className="flex-1 relative h-full bg-gray-200">
        <MapContainer locations={locations} />
      </div>
    </div>
  );
}

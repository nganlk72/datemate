import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { joinTrip, saveGeneratedItinerary } from '../lib/db';
import { generateCompromiseItinerary } from '../lib/ai';
import { fetchLocationsFromOverpass } from '../lib/overpass';
import { searchAddress, geocodeRef } from '../lib/vietmap';
import { Users, Copy, Check, Play, MapPin, Car, Bike, Footprints, Search, Loader2 } from 'lucide-react';

const EMOJIS = ['🐶', '🐱', '🐼', '🦊', '🦁', '🐸', '🦄', '🦖', '🐙', '🦉'];
const SUGGESTIONS = ['Cafe', 'Restaurant', 'Outdoors', 'Museum', 'Shopping', 'Park'];

const FALLBACK_PLACES = [
  { name: "Hoan Kiem Lake", lat: 21.0289, lon: 105.8522, category: "attraction" },
  { name: "Temple of Literature", lat: 21.0294, lon: 105.8355, category: "attraction" },
  { name: "St. Joseph's Cathedral", lat: 21.0287, lon: 105.8489, category: "attraction" },
  { name: "Dong Xuan Market", lat: 21.0379, lon: 105.8509, category: "market" },
];

export default function Lobby() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [participants, setParticipants] = useState([]);
  const [hasJoined, setHasJoined] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [budget, setBudget] = useState(300);
  const [preferences, setPreferences] = useState('');
  const [transportMode, setTransportMode] = useState('car');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);

  // Meetup mode (host only)
  const [meetupMode, setMeetupMode] = useState('independent');
  const [meetupSearchQuery, setMeetupSearchQuery] = useState('');
  const [meetupSearchResults, setMeetupSearchResults] = useState([]);
  const [meetupLocation, setMeetupLocation] = useState(null);

  // Generation status
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState('');

  const isHost = localStorage.getItem(`host_${id}`) === 'true';

  useEffect(() => {
    fetchParticipants();
    const channel = supabase
      .channel(`lobby_${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trip_participants', filter: `trip_id=eq.${id}` },
        (payload) => { setParticipants(current => [...current, payload.new]); }
      )
      .subscribe();

    // Non-host: listen for trip_locations being created (means host generated the itinerary)
    const tripGenChannel = supabase
      .channel(`trip_gen_${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trip_locations', filter: `trip_id=eq.${id}` },
        () => { navigate(`/timeline/${id}`); }
      )
      .subscribe();

    const interval = setInterval(async () => {
      fetchParticipants();
      // Fallback poll: check if locations exist yet (for non-realtime users)
      const { data } = await supabase.from('trip_locations').select('id').eq('trip_id', id).limit(1);
      if (data && data.length > 0) navigate(`/timeline/${id}`);
    }, 3000);

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(tripGenChannel);
      clearInterval(interval);
    };
  }, [id]);

  const fetchParticipants = async () => {
    const { data } = await supabase.from('trip_participants').select('*').eq('trip_id', id);
    if (data) setParticipants(data);
  };

  const handleLocationSearch = async (query, setResults) => {
    if (!query || query.trim().length < 2) return;
    try {
      const results = await searchAddress(query);
      setResults(results); // [{display_name, ref_id}]
    } catch (e) { console.error(e); }
  };

  const handleLocationSelect = async (result, setQuery, setLocation, setResults) => {
    setQuery(result.display_name);
    setResults([]);
    const coords = await geocodeRef(result.ref_id);
    if (coords) {
      setLocation({ lat: coords.lat, lon: coords.lon, name: result.display_name });
    } else {
      alert('Could not resolve location coordinates. Please try another result.');
    }
  };


  const handleSuggestionClick = (sug) => {
    const current = preferences.split(',').map(s => s.trim()).filter(Boolean);
    if (!current.includes(sug)) setPreferences(current.length > 0 ? `${preferences}, ${sug}` : sug);
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!selectedLocation) { alert("Please search and select your starting location first!"); return; }
    setIsSubmitting(true);
    try {
      await joinTrip(id, {
        name, avatar_emoji: emoji,
        budget: parseInt(budget) * 1000,
        start_lat: selectedLocation.lat,
        start_lon: selectedLocation.lon,
        preferences: {
          activities: preferences.split(',').map(p => p.trim()).filter(Boolean),
          transportMode
        }
      });
      // Persist identity so Timeline page knows who this user is
      localStorage.setItem(`name_${id}`, name);
      localStorage.setItem(`emoji_${id}`, emoji);
      setHasJoined(true);
      fetchParticipants();
    } catch (error) {
      alert("Failed to join lobby."); console.error(error);
    } finally { setIsSubmitting(false); }
  };

  const handleGenerate = async () => {
    if (participants.length === 0) { alert("Wait for at least one person to join!"); return; }
    if (meetupMode === 'meetup' && !meetupLocation) { alert("Please select a meetup location first."); return; }
    
    setIsGenerating(true);
    try {
      setGenerateStatus("🧠 Analysing your group's preferences...");
      const aiResult = await generateCompromiseItinerary(participants);
      
      setGenerateStatus(`🗺️ Searching for the best spots in ${aiResult.city}...`);
      let places;
      try {
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000));
        places = await Promise.race([
          fetchLocationsFromOverpass(aiResult.city, aiResult.categories, aiResult.centroidLat, aiResult.centroidLon),
          timeout
        ]);
        if (!places || places.length === 0) places = FALLBACK_PLACES;
      } catch {
        places = FALLBACK_PLACES;
      }

      setGenerateStatus("💾 Saving itinerary...");
      await saveGeneratedItinerary(
        id,
        places.slice(0, 6),
        aiResult.city,
        meetupMode,
        meetupMode === 'meetup' ? meetupLocation : null
      );

      setGenerateStatus("✅ Itinerary ready! Launching...");
      await new Promise(r => setTimeout(r, 800));
      navigate(`/timeline/${id}`);
    } catch (error) {
      console.error("Generation failed:", error);
      alert("Failed to generate itinerary. Please try again.");
    } finally {
      setIsGenerating(false);
      setGenerateStatus('');
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-10 px-4 font-sans text-gray-800">
      <div className="w-full max-w-4xl bg-white rounded-xl shadow-xl overflow-hidden flex flex-col md:flex-row">
        
        {/* Left: Room */}
        <div className="w-full md:w-1/2 p-8 bg-indigo-50 border-r border-indigo-100 flex flex-col">
          <h1 className="text-3xl font-bold text-indigo-900 mb-2 flex items-center"><Users className="mr-3" /> Group Lobby</h1>
          <p className="text-indigo-700 mb-6 text-sm">Waiting for friends to join and submit their preferences...</p>
          <div className="grid grid-cols-3 gap-4 mb-8 flex-1 content-start">
            {participants.map((p, idx) => (
              <div key={idx} className="flex flex-col items-center">
                <div className="w-16 h-16 bg-white rounded-full shadow flex items-center justify-center text-3xl mb-2 border-2 border-indigo-200">{p.avatar_emoji}</div>
                <span className="font-bold text-sm text-indigo-900 truncate w-full text-center">{p.name}</span>
                <span className="text-xs text-indigo-600 font-medium flex items-center justify-center">
                  {p.preferences?.transportMode === 'driving' && <Car size={12} className="mr-1"/>}
                  {p.preferences?.transportMode === 'cycling' && <Bike size={12} className="mr-1"/>}
                  {p.preferences?.transportMode === 'walking' && <Footprints size={12} className="mr-1"/>}
                  {(p.budget/1000).toFixed(0)}k
                </span>
              </div>
            ))}
            {participants.length === 0 && <div className="col-span-3 text-center text-indigo-400 py-10 italic">It's quiet here... invite some friends!</div>}
          </div>
          <button onClick={copyLink} className="flex items-center justify-center w-full bg-white border-2 border-indigo-200 text-indigo-600 font-bold py-3 rounded-lg hover:bg-indigo-100 transition">
            {copied ? <Check size={20} className="mr-2" /> : <Copy size={20} className="mr-2" />}
            {copied ? 'Link Copied!' : 'Copy Invite Link'}
          </button>
        </div>

        {/* Right: Form or Controls */}
        <div className="w-full md:w-1/2 p-8 overflow-y-auto max-h-screen">
          {!hasJoined ? (
            <form onSubmit={handleJoin} className="space-y-5">
              <h2 className="text-2xl font-bold text-gray-800">Join the Trip</h2>
              
              {/* Name + Avatar */}
              <div className="flex items-center space-x-3">
                <div className="relative">
                  <button type="button" onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="w-12 h-12 text-2xl bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 flex items-center justify-center shadow-sm">{emoji}</button>
                  {showEmojiPicker && (
                    <div className="absolute top-14 left-0 bg-white border shadow-xl rounded-lg p-2 grid grid-cols-5 gap-1 z-30 w-max">
                      {EMOJIS.map(em => (
                        <button key={em} type="button" onClick={() => { setEmoji(em); setShowEmojiPicker(false); }} className="text-2xl p-2 hover:bg-indigo-50 rounded">{em}</button>
                      ))}
                    </div>
                  )}
                </div>
                <input required type="text" value={name} onChange={e => setName(e.target.value)} className="flex-1 border p-3 rounded-lg focus:ring-2 focus:ring-indigo-400 focus:outline-none shadow-sm" placeholder="Your Name (e.g. Alex)" />
              </div>

              {/* Starting Location */}
              <div className="relative">
                <label className="block text-sm font-bold text-gray-700 mb-1">Starting Location</label>
                <div className="flex">
                  <input type="text" value={searchQuery}
                    onChange={e => { setSearchQuery(e.target.value); setSelectedLocation(null); }}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleLocationSearch(searchQuery, setSearchResults))}
                    placeholder="Where are you starting from?"
                    className={`flex-1 border p-3 text-sm rounded-l-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 ${selectedLocation ? 'border-green-400 bg-green-50' : 'border-gray-300'}`}
                  />
                  <button type="button" onClick={() => handleLocationSearch(searchQuery, setSearchResults)} className="bg-indigo-100 text-indigo-700 px-4 rounded-r-lg hover:bg-indigo-200 border border-l-0 border-indigo-200"><Search size={18} /></button>
                </div>
                {searchResults.length > 0 && (
                  <ul className="absolute z-20 w-full bg-white border mt-1 max-h-40 overflow-y-auto shadow-xl rounded-lg">
                    {searchResults.map((r, i) => <li key={i} onClick={() => handleLocationSelect(r, setSearchQuery, setSelectedLocation, setSearchResults)} className="p-3 border-b hover:bg-indigo-50 cursor-pointer text-sm flex items-start"><MapPin size={14} className="mr-2 mt-0.5 text-gray-400 flex-shrink-0"/>{r.display_name}</li>)}
                  </ul>
                )}
              </div>

              {/* Transport Mode */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">How will you travel?</label>
                <div className="flex space-x-2">
                  {[['car', Car, '🚗 Car'], ['motorcycle', Bike, '🛵 Motorbike'], ['foot', Footprints, '🚶 Walk']].map(([mode, Icon, label]) => (
                    <button key={mode} type="button" onClick={() => setTransportMode(mode)} className={`flex-1 flex flex-col items-center py-2 rounded-lg border transition ${transportMode === mode ? 'bg-indigo-50 border-indigo-400 text-indigo-700 shadow-sm' : 'bg-white hover:bg-gray-50'}`}>
                      <Icon size={20} className="mb-1"/><span className="text-xs font-medium">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Budget + Activities */}
              <div className="flex space-x-3">
                <div className="w-1/3">
                  <label className="block text-sm font-bold text-gray-700 mb-1">Budget (k VND)</label>
                  <div className="relative">
                    <input required type="number" step="1" min="0" value={budget} onChange={e => setBudget(e.target.value)} className="w-full border p-3 pr-12 rounded-lg focus:ring-2 focus:ring-indigo-400 focus:outline-none shadow-sm" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">k VND</span>
                  </div>
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-bold text-gray-700 mb-1">Activities / Vibes</label>
                  <input required type="text" value={preferences} onChange={e => setPreferences(e.target.value)} className="w-full border p-3 rounded-lg focus:ring-2 focus:ring-indigo-400 focus:outline-none shadow-sm text-sm" placeholder="e.g. cafe, museum" />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map(sug => <button key={sug} type="button" onClick={() => handleSuggestionClick(sug)} className="text-xs bg-gray-100 hover:bg-indigo-100 hover:text-indigo-700 text-gray-600 px-3 py-1.5 rounded-full transition font-medium">+ {sug}</button>)}
              </div>

              <button disabled={isSubmitting} type="submit" className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl hover:bg-indigo-700 disabled:opacity-50 shadow-lg">
                {isSubmitting ? 'Joining...' : 'Jump In!'}
              </button>
            </form>
          ) : (
            <div className="space-y-6">
              <div className="text-center">
                <div className="text-6xl mb-3">🎉</div>
                <h2 className="text-2xl font-bold text-gray-800 mb-1">You're in!</h2>
                <p className="text-gray-500 text-sm">{participants.length} participant{participants.length !== 1 ? 's' : ''} in the lobby</p>
              </div>
              
              {isHost && (
                <div className="space-y-4 border-t pt-5">
                  <h3 className="font-bold text-gray-700">Host Controls</h3>

                  {/* Meetup Mode */}
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">How does the group meet up?</label>
                    <div className="flex space-x-2">
                      <button type="button" onClick={() => setMeetupMode('independent')} className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition ${meetupMode === 'independent' ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white hover:bg-gray-50'}`}>
                        🏃 Each to Dest #1
                      </button>
                      <button type="button" onClick={() => setMeetupMode('meetup')} className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition ${meetupMode === 'meetup' ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white hover:bg-gray-50'}`}>
                        ⭐ Pick Meetup Spot
                      </button>
                    </div>
                  </div>

                  {meetupMode === 'meetup' && (
                    <div className="relative">
                      <label className="block text-sm font-bold text-gray-700 mb-1">Meetup Location</label>
                      <div className="flex">
                        <input type="text" value={meetupSearchQuery}
                          onChange={e => { setMeetupSearchQuery(e.target.value); setMeetupLocation(null); }}
                          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleLocationSearch(meetupSearchQuery, setMeetupSearchResults))}
                          placeholder="Search for a central meetup spot..."
                          className={`flex-1 border p-3 text-sm rounded-l-lg focus:outline-none ${meetupLocation ? 'border-green-400 bg-green-50' : 'border-gray-300'}`}
                        />
                        <button type="button" onClick={() => handleLocationSearch(meetupSearchQuery, setMeetupSearchResults)} className="bg-indigo-100 text-indigo-700 px-4 rounded-r-lg hover:bg-indigo-200 border border-l-0 border-indigo-200"><Search size={18}/></button>
                      </div>
                      {meetupSearchResults.length > 0 && (
                        <ul className="absolute z-20 w-full bg-white border mt-1 max-h-40 overflow-y-auto shadow-xl rounded-lg">
                          {meetupSearchResults.map((r, i) => <li key={i} onClick={() => handleLocationSelect(r, setMeetupSearchQuery, setMeetupLocation, setMeetupSearchResults)} className="p-3 border-b hover:bg-indigo-50 cursor-pointer text-sm">{r.display_name}</li>)}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* Generate Button */}
                  <button onClick={handleGenerate} disabled={isGenerating} className="w-full bg-green-600 text-white font-bold py-4 rounded-xl hover:bg-green-700 disabled:opacity-60 flex items-center justify-center text-base shadow-lg transition">
                    {isGenerating ? <><Loader2 className="animate-spin mr-3" size={22}/>{generateStatus}</> : <><Play className="mr-2" size={22}/> Generate Compromise Trip</>}
                  </button>
                </div>
              )}
              
              {!isHost && (
                <p className="text-center text-gray-500 text-sm italic">Waiting for the host to generate the itinerary...</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState} from 'react';
import { useParams } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../lib/supabase';
import { fetchTripData, updateUserLocation, updateLocationCost, updateStopDuration, updateTripSettings } from '../lib/db';
import { Map, Navigation, GripVertical, Clock, Car, Bike, Footprints, RefreshCw, Loader2, Info, Settings2, X } from 'lucide-react';
import LocationInsights from '../components/LocationInsights';
import { getRoute, getCachedRoute } from '../lib/vietmap';
import TimelineMap from '../components/TimelineMap';

const TRANSPORT_COLORS = {
  car: '#4f46e5', motorcycle: '#16a34a', foot: '#ea580c',
  // Legacy / OSRM aliases — kept in sync with VEHICLE_PROFILES in vietmap.js
  driving: '#4f46e5', cycling: '#16a34a', walking: '#ea580c',
};




/** Convert minutes-from-midnight → "HH:MM" */
function fmtClock(min) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Build a full schedule from the ordered locations + Vietmap group route legs.
 * Returns an array of { ...loc, arrivalMin, departureMin } in minutes-from-midnight.
 */
function buildSchedule(locations, groupRoute, startTime, trafficMult) {
  if (!locations.length) return [];
  const [startH, startM] = (startTime || '09:00').split(':').map(Number);
  let cursor = startH * 60 + startM;

  // Extract leg durations (seconds) from the group route
  const legSeconds = groupRoute?.legs?.map(l => l.duration) || [];

  return locations.map((loc, idx) => {
    // Add travel time from previous stop (with traffic buffer)
    if (idx > 0) {
      const travelSec = legSeconds[idx - 1] || 0;
      cursor += Math.round((travelSec / 60) * (trafficMult || 1.2));
    }
    const arrivalMin = cursor;
    const stayMin = loc.duration_minutes ?? 60;
    cursor += stayMin;
    return { ...loc, arrivalMin, departureMin: cursor, stayMin };
  });
}

export default function Timeline() {
  const { id } = useParams();
  const [mapMode, setMapMode] = useState('overview'); // 'overview' | 'navigation'
  const [trip, setTrip] = useState(null);
  const [locations, setLocations] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [liveUsers, setLiveUsers] = useState({});
  const [groupRoute, setGroupRoute] = useState(null);
  const [personalRoutes, setPersonalRoutes] = useState({}); // keyed by participant name
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [inspectedLocation, setInspectedLocation] = useState(null);

  // User identity (they picked this in the Lobby form)
  const [myName] = useState(() => localStorage.getItem(`name_${id}`) || '');
  const [myEmoji] = useState(() => localStorage.getItem(`emoji_${id}`) || '🐶');

  // Derive schedule synchronously — no useState + useEffect needed
  const schedule = useMemo(() => {
    if (trip && locations.length > 0) {
      return buildSchedule(locations, groupRoute, trip.start_time || '09:00', trip.traffic_multiplier || 1.2);
    }
    return [];
  }, [locations, groupRoute, trip]);

  const calculateGroupRoute = async (locs) => {
    if (locs.length < 2) return;
    try {
      const path = await getRoute(locs, 'car');
      if (path) setGroupRoute(path);
    } catch (e) { console.error('Route error', e); }
  };

  const calculatePersonalRoutes = async (parts, firstDest, tripData) => {
    const routes = {};
    // Determine the target: meetup point or first destination
    const isMeetupMode = tripData?.meetup_mode === 'meetup' && tripData?.meetup_lat;
    const target = isMeetupMode
      ? { lat: tripData.meetup_lat, lon: tripData.meetup_lon }
      : { lat: firstDest.lat, lon: firstDest.lon };

    for (const p of parts) {
      if (!p.start_lat || !p.start_lon) continue;
      const profile = p.preferences?.transportMode || 'car';
      try {
        const path = await getRoute([
          { lat: p.start_lat, lon: p.start_lon },
          target
        ], profile);
        
        if (path) {
          routes[p.name] = {
            ...path,
            transportMode: p.preferences?.transportMode,
            avatar: p.avatar_emoji,
            targetLabel: isMeetupMode ? '⭐ Meetup Spot' : `Stop #1: ${firstDest.name}`
          };
        }
      } catch (e) { console.error(`Route for ${p.name}:`, e); }
    }
    setPersonalRoutes(routes);
  };

  const loadData = useCallback(async () => {
    const data = await fetchTripData(id);
    setTrip(data.trip);
    setLocations(data.locations);
    setParticipants(data.participants);
    if (data.locations.length >= 2) {
      await calculateGroupRoute(data.locations);
    }
    if (data.participants.length > 0 && data.locations.length > 0) {
      await calculatePersonalRoutes(data.participants, data.locations[0], data.trip);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadData();

    // Live user locations channel
    const locChannel = supabase.channel(`locations_${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_locations', filter: `trip_id=eq.${id}` },
        (payload) => {
          const u = payload.new;
          setLiveUsers(prev => ({ ...prev, [u.participant_name]: u }));
        }
      ).subscribe();

    // GPS tracking
    let watchId = null;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(pos => {
        const { latitude: lat, longitude: lon } = pos.coords;
        if (myName) updateUserLocation(id, myName, myEmoji, lat, lon);
        setLiveUsers(prev => ({ ...prev, [myName]: { participant_name: myName, avatar_emoji: myEmoji, lat, lon } }));
      }, null, { enableHighAccuracy: true, maximumAge: 5000 });
    }

    return () => {
      supabase.removeChannel(locChannel);
      if (watchId) navigator.geolocation.clearWatch(watchId);
    };
  }, [id, myName, myEmoji, loadData]);


  const handleCostChange = (locId, val) => {
    const cost = parseInt(val) || 0;
    setLocations(current => current.map(l => l.id === locId ? { ...l, estimated_cost: cost } : l));
  };

  const handleCostBlur = async (locId, val) => {
    const cost = parseInt(val) || 0;
    try {
      await updateLocationCost(id, locId, cost);
    } catch(e) {
      console.error("Failed to update cost", e);
    }
  };


  const handleDurationChange = (locId, val) => {
    const mins = Math.max(1, parseInt(val) || 60);
    setLocations(cur => cur.map(l => l.id === locId ? { ...l, duration_minutes: mins } : l));
  };

  const handleDurationBlur = async (locId, val) => {
    const mins = Math.max(1, parseInt(val) || 60);
    try { await updateStopDuration(id, locId, mins); }
    catch(e) { console.error("Failed to update duration", e); }
  };

  const handleStartTimeChange = async (val) => {
    setTrip(t => ({ ...t, start_time: val }));
    try { await updateTripSettings(id, { start_time: val }); }
    catch(e) { console.error("Failed to update start time", e); }
  };

  const handleTrafficChange = async (val) => {
    const mult = parseFloat(val);
    setTrip(t => ({ ...t, traffic_multiplier: mult }));
    try { await updateTripSettings(id, { traffic_multiplier: mult }); }
    catch(e) { console.error("Failed to update traffic", e); }
  };

  // Budget calculations — DB stores budget in full VND, costs in k VND, so divide budget by 1000
  const groupBudgetK = participants.length > 0 ? Math.min(...participants.map(p => (p.budget || Infinity) / 1000)) : 0;
  const totalCost = locations.reduce((sum, loc) => sum + (loc.estimated_cost || 0), 0);
  const budgetPercent = groupBudgetK > 0 ? Math.min((totalCost / groupBudgetK) * 100, 100) : 0;
  const isOverBudget = totalCost > groupBudgetK;

  const handleDragEnd = async (result) => {
    if (!result.destination) return;
    const items = Array.from(locations);
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved);
    setLocations(items);
    setIsRecalculating(true);
    await calculateGroupRoute(items);
    setIsRecalculating(false);
  };

  const handleRemoveLocation = async (locId) => {
    // Optimistic UI update
    const newLocations = locations.filter(l => l.id !== locId);
    setLocations(newLocations);
    setIsRecalculating(true);
    
    // Update Supabase
    await supabase.from('trip_locations').delete().match({ trip_id: id, location_id: locId });
    
    // Recalculate route
    await calculateGroupRoute(newLocations);
    setIsRecalculating(false);
  };

  const formatTime = (seconds) => {
    if (!seconds) return '';
    const m = Math.round(seconds / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m/60)}h ${m%60}m`;
  };

  const formatDist = (meters) => {
    if (!meters) return '';
    return meters < 1000 ? `${Math.round(meters)}m` : `${(meters/1000).toFixed(1)}km`;
  };

  const allPositions = [
    ...locations.map(l => [l.lat, l.lon]),
    ...Object.values(liveUsers).map(u => [u.lat, u.lon])
  ].filter(p => p[0] && p[1]);

  const myPersonalRoute = personalRoutes[myName];

  const myParticipant = participants.find(p => p.name === myName);
  const transportIcon = myParticipant?.preferences?.transportMode === 'cycling' ? Bike
    : myParticipant?.preferences?.transportMode === 'walking' ? Footprints : Car;
  const TransportIcon = transportIcon;

  if (!trip) return (
    <div className="h-full flex items-center justify-center text-gray-500">
      <Loader2 className="animate-spin mr-2" /> Loading itinerary...
    </div>
  );

  return (
    <div className="flex h-full font-sans text-gray-800">
      {/* Sidebar */}
      <div className="w-1/3 min-w-[340px] max-w-[420px] h-full flex flex-col bg-white border-r shadow-lg z-10">
        {/* Header */}
        <div className="p-5 border-b bg-indigo-50">
          <h1 className="text-xl font-bold text-indigo-900">{trip.title}</h1>
          <p className="text-sm text-indigo-600 mt-1">{participants.length} people · {trip.city}</p>
          
          {/* Mode Toggle */}
          <div className="flex bg-white rounded-lg p-1 mt-3 shadow-inner border">
            <button onClick={() => setMapMode('overview')} className={`flex-1 flex items-center justify-center py-2 rounded text-sm font-bold transition ${mapMode === 'overview' ? 'bg-indigo-600 text-white shadow' : 'text-gray-500 hover:text-gray-700'}`}>
              <Map size={15} className="mr-1.5" /> Overview
            </button>
            <button onClick={() => setMapMode('navigation')} className={`flex-1 flex items-center justify-center py-2 rounded text-sm font-bold transition ${mapMode === 'navigation' ? 'bg-indigo-600 text-white shadow' : 'text-gray-500 hover:text-gray-700'}`}>
              <Navigation size={15} className="mr-1.5" /> My Route
            </button>
          </div>
        </div>

        {mapMode === 'overview' ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-gray-700">Itinerary</h2>
              {isRecalculating && <span className="text-xs text-indigo-500 flex items-center"><RefreshCw size={12} className="animate-spin mr-1"/>Recalculating...</span>}
            </div>
            {groupRoute && (
              <div className="bg-indigo-50 rounded-lg p-3 mb-4 text-sm flex items-center justify-between">
                <span className="font-medium text-indigo-800">Total: {formatDist(groupRoute.distance)}</span>
                <span className="text-indigo-600 flex items-center"><Clock size={13} className="mr-1"/>{formatTime(groupRoute.duration)}</span>
              </div>
            )}

            {/* Budget Progress Bar */}
            {groupBudgetK > 0 && (
              <div className={`rounded-xl p-3 mb-4 border ${isOverBudget ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
                <div className="flex justify-between items-center mb-1.5">
                  <span className={`text-xs font-bold ${isOverBudget ? 'text-red-600' : 'text-gray-600'}`}>
                    {isOverBudget ? '⚠️ Over Budget!' : '💰 Trip Budget'}
                  </span>
                  <span className={`text-xs font-bold ${isOverBudget ? 'text-red-600' : 'text-gray-700'}`}>
                    {totalCost.toLocaleString()}k / {groupBudgetK.toLocaleString()}k VND
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`h-2.5 rounded-full transition-all duration-500 ${isOverBudget ? 'bg-red-500' : budgetPercent >= 75 ? 'bg-yellow-400' : 'bg-emerald-500'}`}
                    style={{ width: `${budgetPercent}%` }}
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Per person · lowest budget in group</p>
              </div>
            )}
            
            {/* Trip Settings Bar */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4">
              <div className="flex items-center mb-2">
                <Settings2 size={14} className="mr-1.5 text-gray-500" />
                <span className="text-xs font-bold text-gray-600">Trip Settings</span>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[10px] text-gray-400 font-medium block mb-1">Start Time</label>
                  <input
                    type="time"
                    value={trip?.start_time || '09:00'}
                    onChange={e => handleStartTimeChange(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-indigo-400 focus:outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-gray-400 font-medium block mb-1">Traffic Buffer</label>
                  <select
                    value={trip?.traffic_multiplier || 1.2}
                    onChange={e => handleTrafficChange(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-indigo-400 focus:outline-none bg-white"
                  >
                    <option value="1.0">1.0× — No buffer</option>
                    <option value="1.2">1.2× — Light traffic</option>
                    <option value="1.5">1.5× — Moderate</option>
                    <option value="2.0">2.0× — Heavy traffic</option>
                  </select>
                </div>
              </div>
            </div>

            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="stops">
                {(provided) => (
                  <ul {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                    {locations.map((loc, idx) => {
                      const sched = schedule[idx];
                      return (
                      <Draggable key={loc.id?.toString() || idx.toString()} draggableId={loc.id?.toString() || idx.toString()} index={idx}>
                        {(provided, snapshot) => (
                          <li ref={provided.innerRef} {...provided.draggableProps} className={`p-3 rounded-lg border text-sm ${snapshot.isDragging ? 'bg-indigo-50 shadow-lg' : 'bg-white hover:bg-gray-50'}`}>
                            <div className="flex items-center">
                              <span {...provided.dragHandleProps} className="mr-2 text-gray-300 hover:text-gray-500 cursor-grab"><GripVertical size={16}/></span>
                              <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs mr-3 flex-shrink-0">{idx + 1}</div>
                              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setInspectedLocation(loc)}>
                                <p className="font-semibold truncate hover:text-indigo-600 transition">{loc.name}</p>
                                <p className="text-xs text-gray-400 capitalize">{loc.category}</p>
                              </div>
                              <button onClick={() => setInspectedLocation(loc)} className="text-gray-400 hover:text-indigo-600 ml-2">
                                <Info size={18} />
                              </button>
                              <button onClick={() => handleRemoveLocation(loc.id)} className="text-gray-400 hover:text-red-600 ml-2">
                                <X size={18} />
                              </button>
                            </div>

                            {/* Time display */}
                            {sched && (
                              <div className="flex items-center mt-2 pl-9 text-xs text-indigo-700 font-medium">
                                <Clock size={12} className="mr-1 text-indigo-400"/>
                                {fmtClock(sched.arrivalMin)} — {fmtClock(sched.departureMin)}
                              </div>
                            )}

                            {/* Duration + Cost inputs */}
                            <div className="flex items-center gap-3 mt-2 pl-9">
                              <div className="flex items-center">
                                <input
                                  type="number"
                                  min="1"
                                  step="5"
                                  placeholder="60"
                                  value={loc.duration_minutes ?? 60}
                                  onChange={e => handleDurationChange(loc.id, e.target.value)}
                                  onBlur={e => handleDurationBlur(loc.id, e.target.value)}
                                  onClick={e => e.stopPropagation()}
                                  className="w-14 text-xs border border-gray-200 rounded-md px-2 py-1 focus:ring-1 focus:ring-indigo-400 focus:outline-none text-right"
                                />
                                <span className="text-xs text-gray-400 ml-1">min</span>
                              </div>
                              <div className="flex items-center">
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  placeholder="0"
                                  value={loc.estimated_cost || ''}
                                  onChange={e => handleCostChange(loc.id, e.target.value)}
                                  onBlur={e => handleCostBlur(loc.id, e.target.value)}
                                  onClick={e => e.stopPropagation()}
                                  className="w-20 text-xs border border-gray-200 rounded-md px-2 py-1 focus:ring-1 focus:ring-indigo-400 focus:outline-none text-right"
                                />
                                <span className="text-xs text-gray-400 ml-1">k VND</span>
                              </div>
                            </div>
                          </li>
                        )}
                      </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </ul>
                )}
              </Droppable>
            </DragDropContext>

            {/* Personal Routes Summary */}
            {Object.keys(personalRoutes).length > 0 && (
              <div className="mt-5">
                <h3 className="font-bold text-gray-700 mb-2 text-sm">
                  Individual ETAs to{' '}
                  {trip?.meetup_mode === 'meetup' ? '⭐ Meetup Spot' : 'Stop #1'}
                </h3>
                <div className="space-y-2">
                  {Object.entries(personalRoutes).map(([name, route]) => {
                    const p = participants.find(pp => pp.name === name);
                    const Icon = route.transportMode === 'cycling' ? Bike : route.transportMode === 'walking' ? Footprints : Car;
                    return (
                      <div key={name} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-sm">
                        <span className="flex items-center font-medium">
                          <span className="mr-2 text-lg">{p?.avatar_emoji}</span>{name}
                        </span>
                        <span className="flex items-center text-gray-500">
                          <Icon size={13} className="mr-1" style={{ color: TRANSPORT_COLORS[route.transportMode] }}/>
                          {formatTime(route.duration)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Navigation Mode Panel */
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center mb-4">
              <div className="text-3xl mr-3">{myEmoji}</div>
              <div>
                <p className="font-bold">{myName || 'Your Route'}</p>
                {myPersonalRoute && (
                  <p className="text-sm text-gray-500 flex items-center">
                    <TransportIcon size={13} className="mr-1" />
                    {formatDist(myPersonalRoute.distance)} · {formatTime(myPersonalRoute.duration)} to Stop #1
                  </p>
                )}
              </div>
            </div>

            {myPersonalRoute?.legs?.[0]?.steps ? (
              <div className="space-y-2">
                <h3 className="font-bold text-gray-700 text-sm mb-2">Turn-by-Turn Directions</h3>
                {myPersonalRoute.legs[0].steps.filter(s => s.maneuver?.type !== 'depart' || s.name).map((step, i) => (
                  <div key={i} className="flex items-start p-3 bg-gray-50 rounded-lg text-sm">
                    <div className="w-6 h-6 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold text-xs mr-3 flex-shrink-0 mt-0.5">{i + 1}</div>
                    <div>
                      <p className="font-medium capitalize">{step.maneuver?.type?.replace(/-/g, ' ')}</p>
                      {step.name && <p className="text-gray-500">{step.name}</p>}
                      <p className="text-indigo-500 text-xs mt-0.5">{formatDist(step.distance)} · {formatTime(step.duration)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-sm italic text-center py-10">
                {myPersonalRoute ? 'No detailed steps available.' : 'Your personal route is being calculated...'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <TimelineMap
          locations={locations}
          trip={trip}
          groupRoute={groupRoute}
          personalRoutes={personalRoutes}
          myPersonalRoute={myPersonalRoute}
          liveUsers={liveUsers}
          mapMode={mapMode}
          allPositions={allPositions}
        />

        {locations.length === 0 && (
          <div className="h-full flex items-center justify-center bg-gray-100 text-gray-500">
            <div className="text-center">
              <div className="text-5xl mb-4">🗺️</div>
              <p className="font-medium">Generating your itinerary...</p>
            </div>
          </div>
        )}
      </div>

      {/* Location Insights Panel */}
      <LocationInsights 
        location={inspectedLocation} 
        myName={myName} 
        onClose={() => setInspectedLocation(null)} 
      />
    </div>
  );
}

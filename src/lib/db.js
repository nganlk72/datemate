import { supabase } from './supabase';

/** Normalise a place name for use in a dedup key: lowercase, strip non-alphanumeric, cap at 20 chars. */
const norm = (s) => (s || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 20);
/** Build a stable, human-readable dedup key from lat/lon + name. */
const placeKey = (lat, lon, name) =>
  `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}-${norm(name)}`;

export async function createGroupTrip(tripParams, locations) {
  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .insert([{ 
      title: `Trip to ${tripParams.city || 'Unknown'}`,
      headcount: tripParams.headcount || 1,
      budget: tripParams.budget || 0,
      city: tripParams.city || 'Unknown'
    }])
    .select()
    .single();

  if (tripError) throw tripError;

  const locationInserts = locations.map(loc => ({
    place_key: placeKey(loc.lat, loc.lon, loc.name || loc.displayName),
    name: loc.name || loc.displayName,
    lat: loc.lat,
    lon: loc.lon,
    category: loc.category || 'unknown'
  }));

  const { data: savedLocations, error: locError } = await supabase
    .from('locations')
    .upsert(locationInserts, { onConflict: 'place_key' })
    .select();

  if (locError) throw locError;

  const tripLocations = savedLocations.map(loc => ({
    trip_id: trip.id,
    location_id: loc.id,
    votes: 0
  }));

  const { error: mappingError } = await supabase
    .from('trip_locations')
    .insert(tripLocations);

  if (mappingError) throw mappingError;
  return trip.id;
}

export async function createEmptyTrip() {
  const { data, error } = await supabase
    .from('trips')
    .insert([{ title: 'Group Trip Lobby' }])
    .select()
    .single();

  if (error) throw error;
  return data.id;
}

export async function joinTrip(tripId, participantData) {
  const { error } = await supabase
    .from('trip_participants')
    .insert([{ trip_id: tripId, ...participantData }]);

  if (error) throw error;
}

export async function saveGeneratedItinerary(tripId, locations, city, meetupMode, meetupCoords) {
  // Update trip metadata
  const tripUpdate = {
    title: `Group Trip in ${city}`,
    city,
    meetup_mode: meetupMode
  };
  if (meetupMode === 'meetup' && meetupCoords) {
    tripUpdate.meetup_lat = meetupCoords.lat;
    tripUpdate.meetup_lon = meetupCoords.lon;
  }

  await supabase.from('trips').update(tripUpdate).eq('id', tripId);

  // Upsert locations
  const locationInserts = locations.map(loc => ({
    place_key: placeKey(loc.lat, loc.lon, loc.name || loc.displayName),
    name: loc.name || loc.displayName,
    lat: loc.lat,
    lon: loc.lon,
    category: loc.category || 'unknown'
  }));

  const { data: savedLocations, error: locError } = await supabase
    .from('locations')
    .upsert(locationInserts, { onConflict: 'place_key' })
    .select();

  if (locError) throw locError;

  // Delete old trip_locations and insert fresh ones
  await supabase.from('trip_locations').delete().eq('trip_id', tripId);

  const tripLocations = savedLocations.map(loc => ({
    trip_id: tripId,
    location_id: loc.id,
    votes: 0
  }));

  const { error: mappingError } = await supabase
    .from('trip_locations')
    .insert(tripLocations);

  if (mappingError) throw mappingError;
}

export async function fetchTripData(tripId) {
  const { data: trip } = await supabase
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single();

  const { data: tripLocations } = await supabase
    .from('trip_locations')
    .select(`estimated_cost, duration_minutes, locations ( id, name, lat, lon, category )`)
    .eq('trip_id', tripId);

  const { data: participants } = await supabase
    .from('trip_participants')
    .select('*')
    .eq('trip_id', tripId);

  return {
    trip,
    locations: (tripLocations || []).map(tl => ({
      ...tl.locations,
      displayName: tl.locations?.name,
      estimated_cost: tl.estimated_cost,
      duration_minutes: tl.duration_minutes ?? 60
    })).filter(Boolean),
    participants: participants || []
  };
}

export async function updateLocationCost(tripId, locationId, cost) {
  const { error } = await supabase
    .from('trip_locations')
    .update({ estimated_cost: cost })
    .eq('trip_id', tripId)
    .eq('location_id', locationId);
  if (error) throw error;
}

export async function updateStopDuration(tripId, locationId, duration_minutes) {
  const { error } = await supabase
    .from('trip_locations')
    .update({ duration_minutes })
    .eq('trip_id', tripId)
    .eq('location_id', locationId);
  if (error) throw error;
}

export async function updateTripSettings(tripId, settings) {
  const { error } = await supabase
    .from('trips')
    .update(settings)
    .eq('id', tripId);
  if (error) throw error;
}

export async function updateUserLocation(tripId, name, emoji, lat, lon) {
  // Upsert by participant name + trip_id
  await supabase.from('user_locations').upsert(
    [{ trip_id: tripId, participant_name: name, avatar_emoji: emoji, lat, lon, updated_at: new Date().toISOString() }],
    { onConflict: 'trip_id,participant_name' }
  );
}

// --- Location Insights & Reviews ---

export async function fetchLocationReviews(locationId) {
  const { data, error } = await supabase
    .from('location_reviews')
    .select('*')
    .eq('location_id', locationId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error("Error fetching reviews:", error);
    return [];
  }
  return data || [];
}

export async function submitLocationReview(locationId, reviewData) {
  const { data, error } = await supabase
    .from('location_reviews')
    .insert([{
      location_id: locationId,
      ...reviewData
    }])
    .select();

  if (error) throw error;
  return data;
}

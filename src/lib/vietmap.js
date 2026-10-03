const API_KEY = import.meta.env.VITE_VIETMAP_API_KEY;
export const TILE_KEY = import.meta.env.VITE_VIETMAP_TILE_KEY;

/** Vietmap satellite raster tiles — confirmed XYZ format, works with react-leaflet TileLayer */
export const VIETMAP_TILE_URL =
  `https://maps.vietmap.vn/maps/tiles/st/{z}/{x}/{y}.png?apikey=${import.meta.env.VITE_VIETMAP_TILE_KEY}`;

/** Vehicle profile mapping: our internal names → Vietmap API values */
export const VEHICLE_PROFILES = {
  car: 'car',
  motorcycle: 'motorcycle',
  foot: 'foot',
  // Legacy OSRM names kept for backward compat
  driving: 'car',
  cycling: 'motorcycle',
  walking: 'foot',
};

/**
 * Autocomplete v4: returns [{display_name, ref_id}]
 * No lat/lng here — call geocodeRef() when user selects a result.
 * @param {string} text - user input
 * @param {number|null} focusLat - map center lat to bias ranking (strongly recommended)
 * @param {number|null} focusLon - map center lon
 */
export async function searchAddress(text, focusLat = null, focusLon = null) {
  try {
    let url = `https://maps.vietmap.vn/api/autocomplete/v4?apikey=${API_KEY}`
      + `&text=${encodeURIComponent(text)}`
      + `&display_type=6`; // returns both old 3-level and new 2-level admin formats
    if (focusLat != null && focusLon != null) {
      url += `&focus=${focusLat},${focusLon}`;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Autocomplete error ${res.status}`);
    const json = await res.json();
    return (json || []).map(item => ({
      display_name: item.display || item.address,
      ref_id: item.ref_id,
    }));
  } catch (e) {
    console.error('Vietmap autocomplete error:', e);
    return [];
  }
}

/**
 * Place v4: resolves a ref_id → {lat, lon, display_name}.
 * IMPORTANT: uses /api/place/v4 (NOT /geocode/v4 which returns 404).
 * Response is a plain object (not an array).
 */
export async function geocodeRef(refId) {
  try {
    const res = await fetch(
      `https://maps.vietmap.vn/api/place/v4?apikey=${API_KEY}&refid=${encodeURIComponent(refId)}`
    );
    if (!res.ok) throw new Error(`Place v4 error ${res.status}`);
    const item = await res.json(); // plain object, not array!
    if (!item || !item.lat) return null;
    return {
      lat: item.lat,
      lon: item.lng, // Vietmap uses 'lng' — already correct
      display_name: item.display || item.address,
    };
  } catch (e) {
    console.error('Vietmap place error:', e);
    return null;
  }
}

/**
 * Route v4: returns route geometry + distance + duration.
 * points = [{lat, lon}, ...], vehicle = 'car' | 'motorcycle' | 'foot'
 * Returns GeoJSON LineString compatible with Leaflet Polyline.
 */
export async function getRoute(points, vehicle = 'car') {
  try {
    const pointParams = points.map(p => `&point=${p.lat},${p.lon}`).join('');
    const profile = VEHICLE_PROFILES[vehicle] || 'car';
    const res = await fetch(
      `https://maps.vietmap.vn/api/route/v4?apikey=${API_KEY}${pointParams}&vehicle=${profile}&points_encoded=false`
    );
    if (!res.ok) throw new Error(`Route error ${res.status}`);
    const json = await res.json();
    const path = json.paths?.[0];
    if (!path) return null;
    return {
      geometry: path.points,    // GeoJSON LineString {type, coordinates: [[lon,lat],...]}
      distance: path.distance,  // metres
      duration: path.time / 1000, // ms → seconds
    };
  } catch (e) {
    console.error('Vietmap routing error:', e);
    return null;
  }
}

/**
 * Reverse v4: lat/lon → Vietnamese address string.
 * Used to label live GPS markers.
 */
export async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(
      `https://maps.vietmap.vn/api/reverse/v4?apikey=${API_KEY}&lat=${lat}&lng=${lon}&display_type=6`
    );
    if (!res.ok) throw new Error(`Reverse error ${res.status}`);
    const json = await res.json();
    return json?.[0]?.display || json?.[0]?.address || null;
  } catch (e) {
    console.error('Vietmap reverse geocode error:', e);
    return null;
  }
}

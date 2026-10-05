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
 * @param {string}      text     - user input
 * @param {number|null} focusLat - map center lat to bias ranking (strongly recommended)
 * @param {number|null} focusLon - map center lon
 * @param {number|null} radius   - circle constraint in metres; requires focusLat/focusLon.
 *                                 When provided, adds circle_center + circle_radius to the
 *                                 request so every result falls inside that circle.
 */
export async function searchAddress(text, focusLat = null, focusLon = null, radius = null, signal = undefined) {
  try {
    let url = `https://maps.vietmap.vn/api/autocomplete/v4?apikey=${API_KEY}`
      + `&text=${encodeURIComponent(text)}`
      + `&display_type=6`; // returns both old 3-level and new 2-level admin formats
    if (focusLat != null && focusLon != null) {
      url += `&focus=${focusLat},${focusLon}`;
      if (radius != null) {
        url += `&circle_center=${focusLat},${focusLon}&circle_radius=${Math.round(radius)}`;
      }
    }
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Autocomplete error ${res.status}`);
    const json = await res.json();
    return (json || []).map(item => ({
      display_name: item.display || item.address,
      ref_id: item.ref_id,
      distance: item.distance, // km from search centre; present in circle-mode responses
    }));
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    console.error('Vietmap autocomplete error:', e);
    return [];
  }
}

/**
 * Place v4: resolves a ref_id → {lat, lon, display_name}.
 * IMPORTANT: uses /api/place/v4 (NOT /geocode/v4 which returns 404).
 * Response is a plain object (not an array).
 */
export async function geocodeRef(refId, signal = undefined) {
  try {
    const res = await fetch(
      `https://maps.vietmap.vn/api/place/v4?apikey=${API_KEY}&refid=${encodeURIComponent(refId)}`,
      { signal }
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
    if (e.name === 'AbortError') throw e;
    console.error('Vietmap place error:', e);
    return null;
  }
}

/**
 * Converts one Vietmap Route v4 path into the shape the app uses.
 * Based on a real response (points_encoded=false):
 *  - points: coordinates as [lon, lat]
 *  - instructions: { distance (m), time (ms), interval: [startIdx, endIdx] into the
 *    coordinate list, sign, text (Vietnamese), street_name }
 *  - an instruction with sign 5 marks reaching an intermediate stop
 */
export function parseRoutePath(path, pointCount) {
  const raw = path.points;
  const coordinates = Array.isArray(raw) ? raw : (raw?.coordinates || []);

  const steps = [];
  let legs = [];
  let leg = { distance: 0, duration: 0, steps: [] };

  for (const ins of path.instructions || []) {
    const isStop = ins.sign === 5; // sign 5 = reached an intermediate stop
    const step = {
      text: ins.text || '',
      street: ins.street_name || '',
      distance: ins.distance || 0,        // metres
      duration: (ins.time || 0) / 1000,   // seconds
      sign: ins.sign,
      stopover: isStop,
      location: coordinates[ins.interval?.[0]] || null, // [lon, lat]
    };
    steps.push(step);
    leg.steps.push(step);
    leg.distance += step.distance;
    leg.duration += step.duration;
    if (isStop) {
      leg.endIndex = ins.interval?.[0] ?? null;
      legs.push(leg);
      leg = { distance: 0, duration: 0, steps: [] };
    }
  }
  if (leg.steps.length > 0) {
    leg.endIndex = coordinates.length - 1;
    legs.push(leg);
  }

  const expected = Math.max(pointCount - 1, 1);
  if (legs.length !== expected) {
    console.warn(`Route: expected ${expected} legs but found ${legs.length}; leg times unavailable`);
    legs = [];
  }

  return {
    geometry: { type: 'LineString', coordinates },
    distance: path.distance,       // metres
    duration: path.time / 1000,    // seconds
    legs,                          // one per hop: { distance, duration, endIndex, steps }
    steps,                         // all directions in order
  };
}

/**
 * Route v4: points = [{lat, lon}, ...], vehicle = 'car' | 'motorcycle' | 'foot'.
 * optimize=false keeps your stops in the order you gave them.
 */
export async function getRoute(points, vehicle = 'car') {
  try {
    const pointParams = points.map(p => `&point=${p.lat},${p.lon}`).join('');
    const profile = VEHICLE_PROFILES[vehicle] || 'car';
    const res = await fetch(
      `https://maps.vietmap.vn/api/route/v4?apikey=${API_KEY}${pointParams}&vehicle=${profile}&points_encoded=false&optimize=false`
    );
    if (!res.ok) throw new Error(`Route error ${res.status}`);
    const json = await res.json();
    const path = json.paths?.[0];
    if (!path) return null;
    return parseRoutePath(path, points.length);
  } catch (e) {
    console.error('Vietmap routing error:', e);
    return null;
  }
}

export async function getCachedRoute(points, vehicle = 'car') {
  if (points.length < 2) return null;
  const keyStr = points.map(p => `${parseFloat(p.lat).toFixed(5)},${parseFloat(p.lon).toFixed(5)}`).join('|');
  const cacheKey = `route_${vehicle}_${keyStr}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
        return parsed.data;
      }
    } catch (e) {
      // invalid JSON, ignore
    }
  }
  const result = await getRoute(points, vehicle);
  if (result) {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: result }));
    } catch (e) {
      // Handle quota exceeded
    }
  }
  return result;
}

export function mergeRoutes(routeA, routeB) {
  if (!routeA) return routeB;
  if (!routeB) return routeA;

  return {
    geometry: {
      type: 'LineString',
      coordinates: [...routeA.geometry.coordinates, ...routeB.geometry.coordinates]
    },
    distance: routeA.distance + routeB.distance,
    duration: routeA.duration + routeB.duration,
    legs: [...routeA.legs, ...routeB.legs],
    steps: [
      ...routeA.steps,
      {
        maneuver: { type: 'arrive' },
        name: 'Arrive at gathering point',
        distance: 0,
        duration: 0,
        isDivider: true
      },
      ...routeB.steps
    ]
  };
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

/**
 * Reverse v4 (raw): lat/lon → the full first result object from the API, or null.
 * Use this when you need structured fields like `boundaries` to extract the city name.
 * For simple address label strings, use reverseGeocode() instead.
 *
 * Example response item shape (display_type=6):
 *   { display, address, ref_id, boundaries: [{ type, name }, …], lat, lng, … }
 * boundary type 0 = city/province; type 1 = district; type 2 = ward/commune.
 */
export async function reverseGeocodeRaw(lat, lon) {
  try {
    const res = await fetch(
      `https://maps.vietmap.vn/api/reverse/v4?apikey=${API_KEY}&lat=${lat}&lng=${lon}&display_type=6`
    );
    if (!res.ok) throw new Error(`Reverse (raw) error ${res.status}`);
    const json = await res.json();
    return json?.[0] ?? null; // full object, not just the display string
  } catch (e) {
    console.error('Vietmap reverse geocode (raw) error:', e);
    return null;
  }
}

import { searchAddress, geocodeRef } from './vietmap';

export const TILE_KEY = import.meta.env.VITE_VIETMAP_TILE_KEY;

// Maps our category names → Vietmap category codes + search keywords
const CATEGORY_MAP = {
  cafe:       { code: '1001-1', keyword: 'cafe' },
  restaurant: { code: '1002',   keyword: 'nhà hàng' },
  attraction: { code: '4004',   keyword: 'điểm tham quan' }, // 4004 is Du Lịch
  museum:     { code: '4001-5', keyword: 'bảo tàng' },
  bar:        { code: '4002-6', keyword: 'bar' },
  park:       { code: '4002-2', keyword: 'công viên' },
  cinema:     { code: '4002-5', keyword: 'rạp chiếu phim' },
  shopping:   { code: '3000',   keyword: 'trung tâm mua sắm' },
  outdoors:   { code: '4002-2', keyword: 'công viên' },
  market:     { code: '3003',   keyword: 'chợ' },
};

/**
 * Module-level cache: ref_id → {lat, lon, display_name}
 * Prevents repeated Place v4 calls for the same POI across searches.
 * Each hit saves one API transaction.
 */
const _detailCache = new Map();

/**
 * Cached wrapper around geocodeRef.
 * Returns the cached result if available; otherwise fetches and caches it.
 */
async function cachedGeocodeRef(refId, _displayName, signal = undefined) {
  if (_detailCache.has(refId)) return _detailCache.get(refId);
  const coords = await geocodeRef(refId, signal);
  if (coords) _detailCache.set(refId, coords);
  return coords;
}

/**
 * Run one autocomplete + detail-lookup round for a single category.
 *
 * @param {string}      keyword   - Vietmap search text
 * @param {string}      cat       - our category label (for output)
 * @param {number|null} lat       - circle/focus centre lat
 * @param {number|null} lon       - circle/focus centre lon
 * @param {number|null} radius    - circle radius in metres (null = focus-only)
 * @param {number}      perCat    - max results to resolve per category
 * @returns {Promise<Array<{name, lat, lon, category}>>}
 *
 * API call budget per round:
 *   • 1 Autocomplete v4 call (returns up to ~10 suggestions)
 *   • Up to `perCat` Place v4 calls (resolved sequentially, skipped if cached)
 */
async function fetchCategory(keyword, cat, lat, lon, radius, perCat = 3, signal = undefined) {
  const items = await searchAddress(keyword, lat, lon, radius, signal);
  // Cap at 10 autocomplete results before detail lookups to limit Place v4 calls
  const candidates = items.slice(0, 10);

  // --- Distance pre-filter (only when a circle radius is active) ---
  // Drop items whose `distance` (km from search centre) exceeds the circle radius
  // BEFORE making any Place v4 calls, saving quota if the API lets stray results through.
  // Items with no distance field are always kept (we can't judge them without coords).
  let filtered = candidates;
  if (radius != null) {
    const maxKm = radius / 1000;
    filtered = candidates.filter(item =>
      item.distance == null || item.distance <= maxKm
    );
    const dropped = candidates.length - filtered.length;
    if (dropped > 0 && dropped > candidates.length / 2) {
      console.warn(
        `[vietmapPoi] ${dropped}/${candidates.length} autocomplete results for` +
        ` "${keyword}" exceeded radius ${radius} m (>${maxKm.toFixed(2)} km).` +
        ` The circle_center/circle_radius constraint may no longer be honored by the API.`
      );
    }
  }

  const resolved = [];
  for (const item of filtered) {
    if (resolved.length >= perCat) break;
    if (!item.ref_id) continue;
    try {
      const coords = await cachedGeocodeRef(item.ref_id, item.display_name, signal);
      if (coords) {
        resolved.push({
          name: item.display_name,
          lat: coords.lat,
          lon: coords.lon,
          category: cat,
        });
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      console.warn(`POI geocode failed for "${item.display_name}":`, e);
    }
  }
  return resolved;
}

/**
 * Discover POIs near a geographic centroid using Vietmap Autocomplete v4 + Place v4.
 *
 * @param {string}      city       - City name (used as search fallback when no centroid)
 * @param {string[]}    categories - e.g. ['cafe', 'attraction']
 * @param {number|null} centerLat  - Group centroid lat (strongly recommended for relevance)
 * @param {number|null} centerLon  - Group centroid lon
 * @param {number|null} radius     - Circle constraint in metres (default 3000 m when a
 *                                   centroid is available). Pass null to use focus-only mode.
 * @returns {Promise<Array<{name, lat, lon, category}>>}
 *
 * API call budget (worst case, no cache hits):
 *   • 1 Autocomplete v4 call per category  → 4 calls
 *   • up to 3 Place v4 calls per category  → 12 calls
 *   Total: ~16 calls per fetchVietmapPoi() invocation.
 *   If a retry fires: up to ~32 calls (retry is capped at one attempt).
 *   Cache hits on ref_ids seen in previous calls reduce this significantly.
 *
 * Retry policy:
 *   If the first pass returns fewer than 3 results across ALL categories,
 *   one retry is made with a doubled radius (max 10 000 m). No further retries.
 */
export async function fetchVietmapPoi(
  city,
  categories,
  centerLat = null,
  centerLon = null,
  radius = null,
  signal = undefined
) {
  const cats = (categories || ['attraction', 'cafe']).slice(0, 4); // cap at 4 to save quota

  // Decide effective radius:
  // • If a center is present but no explicit radius was given, default to 3000 m.
  // • If there is no center at all, radius cannot be used (API requires center).
  const effectiveRadius =
    centerLat != null && centerLon != null
      ? (radius ?? 3000)
      : null;

  /**
   * Run a full pass across all categories with the given radius.
   * Returns a flat array of resolved POIs.
   */
  const runPass = async (r) => {
    const results = [];
    for (const cat of cats) {
      const mapping = CATEGORY_MAP[cat.toLowerCase()] || { keyword: cat };
      // With a centroid, search by keyword alone (circle/focus handles locality).
      // Without one, append the city name for relevance.
      const searchText = centerLat != null
        ? mapping.keyword
        : `${mapping.keyword} ${city}`;
      const catResults = await fetchCategory(searchText, cat, centerLat, centerLon, r, 3, signal);
      results.push(...catResults);
    }
    return results;
  };

  // --- First pass ---
  let places = await runPass(effectiveRadius);

  // --- One retry if sparse (fewer than 3 results total) ---
  if (places.length < 3 && effectiveRadius != null) {
    const retryRadius = Math.min(effectiveRadius * 2, 10000);
    console.warn(
      `[vietmapPoi] Only ${places.length} result(s) with radius ${effectiveRadius} m. ` +
      `Retrying once with ${retryRadius} m…`
    );
    places = await runPass(retryRadius);
  }

  return places;
}

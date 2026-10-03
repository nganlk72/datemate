import { geocodeRef } from './vietmap';

const API_KEY = import.meta.env.VITE_VIETMAP_API_KEY;
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
 * Discover POIs near a geographic centroid using Vietmap Autocomplete v4 + Place v4.
 * Replaces the old Overpass API calls (overpass-api.de is unreachable).
 *
 * @param {string}      city       - City name (used as fallback label only)
 * @param {string[]}    categories - e.g. ['cafe', 'attraction']
 * @param {number|null} centerLat  - Group centroid lat (strongly recommended for relevance)
 * @param {number|null} centerLon  - Group centroid lon
 * @returns {Promise<Array<{name, lat, lon, category}>>}
 *
 * Transaction cost: ~4 categories × 2 place lookups = ~12 transactions per call.
 */
export async function fetchLocationsFromOverpass(city, categories, centerLat = null, centerLon = null) {
  const results = [];
  const cats = (categories || ['attraction', 'cafe']).slice(0, 4); // cap at 4 to save quota

  for (const cat of cats) {
    const mapping = CATEGORY_MAP[cat.toLowerCase()] || { keyword: cat };
    let url = `https://maps.vietmap.vn/api/autocomplete/v4?apikey=${API_KEY}`
      + `&display_type=6`
      + `&size=4`;
      
    if (mapping.code) {
      url += `&cats=${mapping.code}`;
    }
    const searchText = (centerLat != null) ? mapping.keyword : `${mapping.keyword} ${city}`;
    url += `&text=${encodeURIComponent(searchText)}`;

    if (centerLat != null && centerLon != null) {
      url += `&focus=${centerLat},${centerLon}`
           + `&circle_center=${centerLat},${centerLon}`
           + `&circle_radius=5000`; // 5 km radius around group centroid
    }

    try {
      const res = await fetch(url);
      if (!res.ok) { console.warn(`Autocomplete failed for "${cat}": ${res.status}`); continue; }
      const json = await res.json();

      // Take top 2 per category, resolve each to full coordinates via Place v4
      for (const item of (json || []).slice(0, 2)) {
        if (!item.ref_id) continue;
        const coords = await geocodeRef(item.ref_id);
        if (coords) {
          results.push({
            name: item.display || item.address,
            lat: coords.lat,
            lon: coords.lon,
            category: cat,
          });
        }
      }
    } catch (e) {
      console.warn(`POI search failed for category "${cat}":`, e);
    }
  }

  return results;
}

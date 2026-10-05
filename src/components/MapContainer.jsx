import React, { useCallback, useEffect, useRef, useState } from 'react';
import vietmapgl from '@vietmap/vietmap-gl-js/dist/vietmap-gl';
import '@vietmap/vietmap-gl-js/dist/vietmap-gl.css';
import { TILE_KEY } from '../lib/vietmap';

const { Map: VietmapMap, NavigationControl, Popup, Marker, LngLatBounds } = vietmapgl;

// ─── Constants ────────────────────────────────────────────────────────────────
const INITIAL_STYLE = 'tm';

const MAP_STYLES = {
  Street:    'tm',   // Default Vietnam street map
  Light:     'lm',   // Light / clean
  Dark:      'dm',   // Dark theme
  Satellite: 'hm',   // Hybrid (satellite + labels)
};

const DEFAULT_CENTER = [105.8542, 21.0285]; // Hanoi [lon, lat]

// ─── Module-level helpers ─────────────────────────────────────────────────────

function styleUrl(code) {
  return `https://maps.vietmap.vn/maps/styles/${code}/style.json?apikey=${TILE_KEY}`;
}

/** Escape user text before inserting into popup HTML. */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Add the route GeoJSON source if it does not already exist.
 * @param {object} map - The VietmapMap instance.
 * @param {Array}  coordinates - Initial coordinate array (lon, lat pairs).
 */
function addRouteSource(map, coordinates = []) {
  if (!map.getSource('route')) {
    map.addSource('route', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates }
      }
    });
  }
}

/** Add the route line layer if it does not already exist. */
function addRouteLayer(map) {
  if (!map.getLayer('route-layer')) {
    map.addLayer({
      id: 'route-layer',
      type: 'line',
      source: 'route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#5b19ff', 'line-width': 5, 'line-opacity': 0.8 }
    });
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CustomMapContainer({ locations, routeGeometry }) {
  const mapContainer  = useRef(null);
  const mapRef        = useRef(null);
  const markersRef    = useRef([]);
  const propsRef      = useRef({ locations, routeGeometry });
  const appliedStyleRef = useRef(INITIAL_STYLE); // tracks what style the map is currently showing

  const [currentStyle, setCurrentStyle] = useState(INITIAL_STYLE);

  // ── Effect 1: keep propsRef in sync (declared first, runs before all others) ──
  useEffect(() => {
    propsRef.current = { locations, routeGeometry };
  }); // intentionally no dep array — runs after every render

  // ── updateMapData: stable identity, reads latest props from propsRef ──────────
  const updateMapData = useCallback(({ force = false } = {}) => {
    const m = mapRef.current;
    if (!force && !m?.isStyleLoaded()) return;

    const { locations: locs, routeGeometry: rg } = propsRef.current;

    // Remove old markers
    markersRef.current.forEach(mk => mk.remove());
    markersRef.current = [];

    const bounds = new LngLatBounds();
    let hasPoints = false;

    locs.forEach((loc, index) => {
      if (!loc.lat || !loc.lon) return;

      const el = document.createElement('div');
      el.style.cssText = 'width:28px;height:28px;background:#5b19ff;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:13px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer;';
      el.textContent = (index + 1).toString();

      const popup = new Popup({ offset: 25 })
        .setHTML(`<b>${index + 1}.</b> ${esc(loc.displayName || loc.name)}`);

      const marker = new Marker({ element: el })
        .setLngLat([loc.lon, loc.lat])
        .setPopup(popup)
        .addTo(m);

      markersRef.current.push(marker);
      bounds.extend([loc.lon, loc.lat]);
      hasPoints = true;
    });

    const src = m.getSource('route');
    if (src) {
      const coords = rg?.coordinates || [];
      src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
      coords.forEach(c => { bounds.extend(c); hasPoints = true; });
    }

    if (hasPoints) {
      m.fitBounds(bounds, { padding: 50, duration: 800 });
    }
  }, []); // stable — all prop reads go through propsRef

  // ── Effect 2: create map once ─────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return;

    const { locations: locs } = propsRef.current;
    const initialCenter = locs.length > 0
      ? [locs[0].lon, locs[0].lat]
      : DEFAULT_CENTER;

    mapRef.current = new VietmapMap({
      container: mapContainer.current,
      style: styleUrl(INITIAL_STYLE),
      center: initialCenter,
      zoom: 13,
    });

    mapRef.current.addControl(new NavigationControl(), 'bottom-right');

    // Add sources/layers once the initial style is loaded, then paint current data.
    // The style-switch effect skips on mount (appliedStyleRef already equals INITIAL_STYLE),
    // so this 'load' handler is the only place that bootstraps sources on first load.
    mapRef.current.on('load', () => {
      addRouteSource(mapRef.current);
      addRouteLayer(mapRef.current);
      updateMapData({ force: true });
    });

    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, [updateMapData]); // updateMapData is useCallback([]) — identity never changes

  // ── Effect 3: style switching ─────────────────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    // Skip if the map already shows this style (prevents double-init on mount).
    if (appliedStyleRef.current === currentStyle) return;
    appliedStyleRef.current = currentStyle;

    // { diff: false } silences "Unable to perform style diff" console warnings.
    m.setStyle(styleUrl(currentStyle), { diff: false });

    // Named function so we can remove it in cleanup (prevents listener leak on
    // rapid style switches before the previous style.load fires).
    function onStyleLoad() {
      const { routeGeometry: rg } = propsRef.current;
      // Pass current coordinates so the route is visible immediately after a style change,
      // without waiting for the next data-effect run.
      addRouteSource(m, rg?.coordinates || []);
      addRouteLayer(m);
      updateMapData({ force: true });
    }

    m.on('style.load', onStyleLoad);
    return () => m.off('style.load', onStyleLoad);
  }, [currentStyle, updateMapData]);

  // ── Effect 4: repaint when data changes ───────────────────────────────────────
  useEffect(() => { updateMapData(); }, [locations, routeGeometry, updateMapData]);

  return (
    <div className="relative w-full h-full min-h-[400px]" style={{ minHeight: '100%' }}>
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

      {/* Vietmap native style switcher */}
      <div className="absolute top-3 right-3 z-10 flex bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        {Object.entries(MAP_STYLES).map(([name, code]) => (
          <button
            key={code}
            onClick={() => setCurrentStyle(code)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              currentStyle === code
                ? 'bg-[#5b19ff] text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

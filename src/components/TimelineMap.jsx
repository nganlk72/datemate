import React, { useCallback, useEffect, useRef, useState } from 'react';
import vietmapgl from '@vietmap/vietmap-gl-js/dist/vietmap-gl';
import '@vietmap/vietmap-gl-js/dist/vietmap-gl.css';
import { TILE_KEY } from '../lib/vietmap';

const { Map: VietmapMap, NavigationControl, Popup, Marker, LngLatBounds } = vietmapgl;

// ─── Constants ────────────────────────────────────────────────────────────────
const INITIAL_STYLE = 'tm';

const MAP_STYLES = {
  Street:    'tm',
  Light:     'lm',
  Dark:      'dm',
  Satellite: 'hm',
};

const DEFAULT_CENTER = [105.8542, 21.0285]; // Hanoi [lon, lat]

// Transport mode → route colour. Includes both canonical and alias key names
// so callers can pass 'car', 'driving', 'foot', 'walking', 'motorcycle', 'cycling'.
const TRANSPORT_COLORS = {
  car:        '#4f46e5', driving:  '#4f46e5',
  motorcycle: '#16a34a', cycling:  '#16a34a',
  foot:       '#ea580c', walking:  '#ea580c',
};

// ─── Module-level helpers ─────────────────────────────────────────────────────

function styleUrl(code) {
  return `https://maps.vietmap.vn/maps/styles/${code}/style.json?apikey=${TILE_KEY}`;
}

/** Escape user-supplied text before injecting into popup / marker innerHTML. */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Names are compared trimmed + lowercase (same rule as Timeline.jsx). */
const normName = (s) => (s || '').trim().toLowerCase();

/**
 * Idempotent: add all GeoJSON sources and line layers needed by TimelineMap.
 * Safe to call on every style.load — existing sources/layers are skipped.
 */
function initSources(m) {
  const emptyLine = {
    type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [] }
  };

  const addSrc = (id) => {
    if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: emptyLine });
  };

  const addLine = (id, src, color, width, opacity, dash) => {
    if (m.getLayer(id)) return;
    const paint = { 'line-color': color, 'line-width': width, 'line-opacity': opacity };
    if (dash) paint['line-dasharray'] = dash;
    m.addLayer({
      id, type: 'line', source: src,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint
    });
  };

  addSrc('group-route');  addLine('group-route-layer', 'group-route', '#4f46e5', 5, 0.85, null);
  addSrc('my-route');     addLine('my-route-layer',    'my-route',    '#ea580c', 6, 0.95, null);
  for (let i = 0; i < 10; i++) {
    addSrc(`p-route-${i}`);
    addLine(`p-route-layer-${i}`, `p-route-${i}`, '#888888', 3, 0.7, [4, 4]);
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Props
 *  - groupRoute : the SHARED route (gathering point → every stop)
 *  - myRoute    : my full route (my start → gathering point → every stop), already stitched
 *  - myStart    : my REGISTERED start point { lat, lon } (not the live GPS position)
 *  - myName     : used to show only my own live marker in My Route mode
 */
export default function TimelineMap({
  locations,
  trip,
  groupRoute,
  personalRoutes,
  myRoute,
  myStart,
  myName,
  liveUsers,
  mapMode,
  allPositions
}) {
  const mapContainer    = useRef(null);
  const mapRef          = useRef(null);
  const markersRef      = useRef([]);
  const appliedStyleRef = useRef(INITIAL_STYLE); // tracks the style currently loaded on the map
  const prevFitDepsRef  = useRef(null);          // lets us refit only when the route / mode data changed
  const propsRef        = useRef({
    locations, trip, groupRoute, personalRoutes,
    myRoute, myStart, myName, liveUsers, mapMode, allPositions
  });

  const [currentStyle, setCurrentStyle] = useState(INITIAL_STYLE);

  // ── Effect 1: keep propsRef in sync (declared first, runs before all others) ──
  useEffect(() => {
    propsRef.current = {
      locations, trip, groupRoute, personalRoutes,
      myRoute, myStart, myName, liveUsers, mapMode, allPositions
    };
  }); // intentionally no dep array — runs after every render

  // ── updateMapData: stable identity, reads latest props from propsRef ──────────
  // fit=false repaints without moving the camera (used for live-location updates and style switches).
  const updateMapData = useCallback(({ force = false, fit = true } = {}) => {
    const m = mapRef.current;
    if (!m || (!force && !m.isStyleLoaded())) return;

    const {
      locations: locs,
      trip: tr,
      groupRoute: gr,
      personalRoutes: pr,
      myRoute: mine,
      myStart: start,
      myName: me,
      liveUsers: lu,
      mapMode: mode
    } = propsRef.current;

    // Clear old HTML markers
    markersRef.current.forEach(mk => mk.remove());
    markersRef.current = [];

    const bounds = new LngLatBounds();
    let hasPoints = false;

    // inBounds=false keeps a marker out of the camera fit (live GPS markers must not move the camera).
    const addMarker = (lat, lon, html, popupHtml, inBounds = true) => {
      if (!lat || !lon) return;
      const el = document.createElement('div');
      el.innerHTML = html;
      const mk = new Marker({ element: el.firstChild }).setLngLat([lon, lat]);
      if (popupHtml) mk.setPopup(new Popup({ offset: 25 }).setHTML(popupHtml));
      mk.addTo(m);
      markersRef.current.push(mk);
      if (inBounds) {
        bounds.extend([lon, lat]);
        hasPoints = true;
      }
    };

    // Destination number markers
    (locs || []).forEach((loc, idx) => {
      addMarker(
        loc.lat, loc.lon,
        `<div style="width:28px;height:28px;background:#4f46e5;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:13px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);">${idx + 1}</div>`,
        `<b>${idx + 1}. ${esc(loc.name)}</b><br/><span style="color:#6b7280;text-transform:capitalize">${esc(loc.category)}</span>`
      );
    });

    // Meetup star marker
    if (tr?.meetup_mode === 'meetup' && tr.meetup_lat) {
      addMarker(
        tr.meetup_lat, tr.meetup_lon,
        `<div style="width:36px;height:36px;background:#fbbf24;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.25);">⭐</div>`,
        'Meetup Spot'
      );
    }

    // My registered start point — shown in My Route mode so it is clear where the line begins
    if (mode !== 'overview' && start?.lat && start?.lon) {
      addMarker(
        start.lat, start.lon,
        `<div style="padding:3px 10px;background:#16a34a;color:white;border-radius:999px;font-size:11px;font-weight:700;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);">Start</div>`,
        'Your start location'
      );
    }

    // Live user markers — participant_name and avatar_emoji are user-controlled, must escape.
    // In My Route mode only my own marker is shown. Live markers never affect the camera fit.
    Object.values(lu || {})
      .filter(u => mode === 'overview' || normName(u.participant_name) === normName(me))
      .forEach(u => {
        addMarker(
          u.lat, u.lon,
          `<div style="width:36px;height:36px;background:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;border:2px solid #6366f1;box-shadow:0 2px 8px rgba(0,0,0,0.25);">${esc(u.avatar_emoji || '👤')}</div>`,
          esc(u.participant_name),
          false
        );
      });

    // Route helpers
    const setRoute = (srcId, coords) => {
      const src = m.getSource(srcId);
      if (!src) return;
      src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords || [] } });
      (coords || []).forEach(c => { bounds.extend(c); hasPoints = true; });
    };

    const setRouteColor = (layerId, color) => {
      if (m.getLayer(layerId)) m.setPaintProperty(layerId, 'line-color', color);
    };

    if (mode === 'overview') {
      setRoute('group-route', gr?.geometry?.coordinates || []);
      setRoute('my-route', []);
      const pRoutes = Object.values(pr || {});
      for (let i = 0; i < 10; i++) {
        if (i < pRoutes.length && pRoutes[i]?.geometry?.coordinates) {
          const color = TRANSPORT_COLORS[pRoutes[i].transportMode] || '#888888';
          setRouteColor(`p-route-layer-${i}`, color);
          setRoute(`p-route-${i}`, pRoutes[i].geometry.coordinates);
        } else {
          setRoute(`p-route-${i}`, []);
        }
      }
    } else {
      // My Route mode — only my own full route (start → gathering point → every stop).
      // Other people's lines and the shared line are hidden.
      setRoute('group-route', []);
      for (let i = 0; i < 10; i++) setRoute(`p-route-${i}`, []);
      setRoute('my-route', mine?.geometry?.coordinates || []);
    }

    if (fit && hasPoints) m.fitBounds(bounds, { padding: 50, duration: 800 });
  }, []); // stable — all prop reads go through propsRef

  // ── Effect 2: create map once ─────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return;

    const { allPositions: pos } = propsRef.current;
    const initialCenter = pos && pos.length > 0
      ? [pos[0][1], pos[0][0]]  // [lat, lon] → [lon, lat]
      : DEFAULT_CENTER;

    mapRef.current = new VietmapMap({
      container: mapContainer.current,
      style: styleUrl(INITIAL_STYLE),
      center: initialCenter,
      zoom: 13,
    });

    mapRef.current.addControl(new NavigationControl(), 'bottom-right');

    // Bootstrap sources/layers once initial style loads, then paint current data.
    // The style-switch effect skips on mount (appliedStyleRef already equals INITIAL_STYLE),
    // so this 'load' handler is the only thing that runs initSources on first load.
    mapRef.current.on('load', () => {
      initSources(mapRef.current);
      updateMapData({ force: true });
    });

    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, [updateMapData]); // updateMapData is useCallback([]) — identity never changes

  // ── Effect 3: style switching ─────────────────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    // No-op on mount: appliedStyleRef starts at INITIAL_STYLE === currentStyle.
    if (appliedStyleRef.current === currentStyle) return;
    appliedStyleRef.current = currentStyle;

    // { diff: false } silences "Unable to perform style diff" console warnings.
    m.setStyle(styleUrl(currentStyle), { diff: false });

    // Named function enables m.off() cleanup to prevent listener accumulation
    // if the user switches styles rapidly before the previous style.load fires.
    function onStyleLoad() {
      initSources(m);
      updateMapData({ force: true, fit: false }); // a style switch must not move the camera
    }

    m.on('style.load', onStyleLoad);
    return () => m.off('style.load', onStyleLoad);
  }, [currentStyle, updateMapData]);

  // ── Effect 4: repaint when data changes ───────────────────────────────────────
  // The camera is refitted only when the route / stop / mode data changed — NOT when a live
  // GPS marker moved. allPositions is intentionally excluded: the parent creates a new array
  // each render and including it would cause the map to re-fit on every render.
  useEffect(() => {
    const fitDeps = [locations, trip, groupRoute, personalRoutes, myRoute, myStart, mapMode];
    const prev = prevFitDepsRef.current;
    const changed = !prev || fitDeps.some((d, i) => d !== prev[i]);
    prevFitDepsRef.current = fitDeps;
    updateMapData({ fit: changed });
  }, [locations, trip, groupRoute, personalRoutes, myRoute, myStart, mapMode, liveUsers, updateMapData]);

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
                ? 'bg-indigo-600 text-white'
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

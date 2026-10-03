import React, { useEffect, useRef, useState } from 'react';
import vietmapgl from '@vietmap/vietmap-gl-js/dist/vietmap-gl';
import '@vietmap/vietmap-gl-js/dist/vietmap-gl.css';
import { TILE_KEY } from '../lib/vietmap';

const { Map: VietmapMap, NavigationControl, Popup, Marker, LngLatBounds } = vietmapgl;

const MAP_STYLES = {
  Street:    'tm',
  Light:     'lm',
  Dark:      'dm',
  Satellite: 'hm',
};

function styleUrl(code) {
  return `https://maps.vietmap.vn/maps/styles/${code}/style.json?apikey=${TILE_KEY}`;
}

const TRANSPORT_COLORS = { car: '#4f46e5', motorcycle: '#16a34a', foot: '#ea580c' };

export default function TimelineMap({
  locations,
  trip,
  groupRoute,
  personalRoutes,
  myPersonalRoute,
  liveUsers,
  mapMode,
  allPositions
}) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [currentStyle, setCurrentStyle] = useState('tm');

  const defaultCenter = [105.8542, 21.0285];

  // ─── Initialize map ───────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return;

    const initialCenter = allPositions.length > 0
      ? [allPositions[0][1], allPositions[0][0]]  // [lat, lon] → [lon, lat]
      : defaultCenter;

    mapRef.current = new VietmapMap({
      container: mapContainer.current,
      style: styleUrl(currentStyle),
      center: initialCenter,
      zoom: 13,
    });

    mapRef.current.addControl(new NavigationControl(), 'bottom-right');

    mapRef.current.on('load', () => {
      initSources();
      updateMapData();
    });

    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  // ─── Style switching ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setStyle(styleUrl(currentStyle));
    mapRef.current.once('style.load', () => {
      initSources();
      updateMapData();
    });
  }, [currentStyle]);

  // ─── Source/layer setup ────────────────────────────────────────────────────
  const initSources = () => {
    const m = mapRef.current;
    const emptyLine = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } };

    const addSrc = (id) => { if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: emptyLine }); };
    const addLine = (id, src, color, width, opacity, dash) => {
      if (m.getLayer(id)) return;
      const paint = { 'line-color': color, 'line-width': width, 'line-opacity': opacity };
      if (dash) paint['line-dasharray'] = dash;
      m.addLayer({ id, type: 'line', source: src, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint });
    };

    addSrc('group-route');     addLine('group-route-layer',  'group-route',  '#4f46e5', 5, 0.85, null);
    addSrc('my-route');        addLine('my-route-layer',     'my-route',     '#ea580c', 5, 0.9,  null);
    for (let i = 0; i < 10; i++) {
      addSrc(`p-route-${i}`);  addLine(`p-route-layer-${i}`, `p-route-${i}`, '#888888', 3, 0.7, [4, 4]);
    }
  };

  // ─── Data sync ────────────────────────────────────────────────────────────
  const updateMapData = () => {
    const m = mapRef.current;
    if (!m?.isStyleLoaded()) return;

    // Clear old HTML markers
    markersRef.current.forEach(mk => mk.remove());
    markersRef.current = [];

    const bounds = new LngLatBounds();
    let hasPoints = false;

    const addMarker = (lat, lon, html, popupHtml) => {
      if (!lat || !lon) return;
      const el = document.createElement('div');
      el.innerHTML = html;
      const mk = new Marker({ element: el.firstChild })
        .setLngLat([lon, lat]);
      if (popupHtml) mk.setPopup(new Popup({ offset: 25 }).setHTML(popupHtml));
      mk.addTo(m);
      markersRef.current.push(mk);
      bounds.extend([lon, lat]);
      hasPoints = true;
    };

    // Destination numbers
    (locations || []).forEach((loc, idx) => {
      addMarker(
        loc.lat, loc.lon,
        `<div style="width:28px;height:28px;background:#4f46e5;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:13px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);">${idx+1}</div>`,
        `<b>${idx + 1}. ${loc.name}</b><br/><span style="color:#6b7280;text-transform:capitalize">${loc.category}</span>`
      );
    });

    // Meetup star
    if (trip?.meetup_mode === 'meetup' && trip.meetup_lat) {
      addMarker(trip.meetup_lat, trip.meetup_lon,
        `<div style="width:36px;height:36px;background:#fbbf24;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.25);">⭐</div>`,
        'Meetup Spot'
      );
    }

    // Live users
    Object.values(liveUsers || {}).forEach(u => {
      addMarker(u.lat, u.lon,
        `<div style="width:36px;height:36px;background:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;border:2px solid #6366f1;box-shadow:0 2px 8px rgba(0,0,0,0.25);">${u.avatar_emoji || '👤'}</div>`,
        u.participant_name
      );
    });

    // Routes
    const setRoute = (srcId, coords) => {
      const src = m.getSource(srcId);
      if (src) {
        src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords || [] } });
        (coords || []).forEach(c => { bounds.extend(c); hasPoints = true; });
      }
    };

    // Update personal route colors dynamically
    const setRouteColor = (layerId, color) => {
      if (m.getLayer(layerId)) m.setPaintProperty(layerId, 'line-color', color);
    };

    if (mapMode === 'overview') {
      setRoute('group-route', groupRoute?.geometry?.coordinates || []);
      setRoute('my-route', []);
      const pRoutes = Object.values(personalRoutes || {});
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
      // Navigation mode — only show my personal route
      setRoute('group-route', []);
      for (let i = 0; i < 10; i++) setRoute(`p-route-${i}`, []);
      setRoute('my-route', myPersonalRoute?.geometry?.coordinates || []);
    }

    if (hasPoints) m.fitBounds(bounds, { padding: 50, duration: 800 });
  };

  useEffect(() => { updateMapData(); }, [locations, trip, groupRoute, personalRoutes, myPersonalRoute, liveUsers, mapMode]);

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

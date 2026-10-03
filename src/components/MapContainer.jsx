import React, { useEffect, useRef, useState } from 'react';
import vietmapgl from '@vietmap/vietmap-gl-js/dist/vietmap-gl';
import '@vietmap/vietmap-gl-js/dist/vietmap-gl.css';
import { TILE_KEY } from '../lib/vietmap';

const { Map: VietmapMap, NavigationControl, Popup, Marker, LngLatBounds } = vietmapgl;

// Vietmap built-in styles — all served from Vietmap CDN with Tilemap key
const MAP_STYLES = {
  Street:    'tm',   // Default Vietnam street map
  Light:     'lm',   // Light / clean
  Dark:      'dm',   // Dark theme
  Satellite: 'hm',   // Hybrid (satellite + labels)
};

function styleUrl(code) {
  return `https://maps.vietmap.vn/maps/styles/${code}/style.json?apikey=${TILE_KEY}`;
}

export default function CustomMapContainer({ locations, routeGeometry }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [currentStyle, setCurrentStyle] = useState('tm');

  const defaultCenter = [105.8542, 21.0285]; // Hanoi [lon, lat]

  // Initialize Map once
  useEffect(() => {
    if (mapRef.current) return;

    const initialCenter = locations.length > 0
      ? [locations[0].lon, locations[0].lat]
      : defaultCenter;

    mapRef.current = new VietmapMap({
      container: mapContainer.current,
      style: styleUrl(currentStyle),
      center: initialCenter,
      zoom: 13,
    });

    mapRef.current.addControl(new NavigationControl(), 'bottom-right');

    mapRef.current.on('load', () => {
      mapRef.current.addSource('route', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
      });
      mapRef.current.addLayer({
        id: 'route-layer',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#4f46e5', 'line-width': 5, 'line-opacity': 0.8 }
      });
      updateMapData();
    });

    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  // Swap style when user clicks a button
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setStyle(styleUrl(currentStyle));
    mapRef.current.once('style.load', () => {
      if (!mapRef.current.getSource('route')) {
        mapRef.current.addSource('route', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeGeometry || [] } }
        });
        mapRef.current.addLayer({
          id: 'route-layer', type: 'line', source: 'route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#4f46e5', 'line-width': 5, 'line-opacity': 0.8 }
        });
      }
      updateMapData();
    });
  }, [currentStyle]);

  const updateMapData = () => {
    if (!mapRef.current?.isStyleLoaded()) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const bounds = new LngLatBounds();
    let hasPoints = false;

    locations.forEach((loc, index) => {
      if (!loc.lat || !loc.lon) return;
      const el = document.createElement('div');
      el.style.cssText = 'width:28px;height:28px;background:#4f46e5;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:13px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer;';
      el.textContent = (index + 1).toString();

      const popup = new Popup({ offset: 25 })
        .setHTML(`<b>${index + 1}.</b> ${loc.displayName || loc.name}`);

      const marker = new Marker({ element: el })
        .setLngLat([loc.lon, loc.lat])
        .setPopup(popup)
        .addTo(mapRef.current);

      markersRef.current.push(marker);
      bounds.extend([loc.lon, loc.lat]);
      hasPoints = true;
    });

    const src = mapRef.current.getSource('route');
    if (src) {
      const coords = routeGeometry || [];
      src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
      coords.forEach(c => { bounds.extend(c); hasPoints = true; });
    }

    if (hasPoints) {
      mapRef.current.fitBounds(bounds, { padding: 50, duration: 800 });
    }
  };

  useEffect(() => { updateMapData(); }, [locations, routeGeometry]);

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

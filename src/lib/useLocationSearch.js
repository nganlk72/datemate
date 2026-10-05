import { useCallback, useEffect, useRef, useState } from 'react';
import { searchAddress, geocodeRef } from './vietmap';

/** Calls onAway when the user presses outside the referenced element. */
export function useClickAway(ref, onAway) {
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onAway(); };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [ref, onAway]);
}

/** Debounced VietMap place search + selection (resolves the pick to lat/lon). */
export function useLocationSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const pickedText = useRef(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || q === pickedText.current) { setResults([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setResults((await searchAddress(q, null, null, null, controller.signal)) || []);
      } catch (e) {
        if (e.name !== 'AbortError') console.error(e);
      }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  const onChange = useCallback((value) => {
    pickedText.current = null;
    setQuery(value);
    setSelected(null);
    setError('');
  }, []);

  const select = useCallback(async (result) => {
    pickedText.current = result.display_name;
    setQuery(result.display_name);
    setResults([]);
    try {
      const coords = await geocodeRef(result.ref_id);
      if (coords) { setSelected({ lat: coords.lat, lon: coords.lon, name: result.display_name }); setError(''); }
      else setError("Couldn't find that spot on the map. Try another result.");
    } catch (e) {
      console.error(e);
      setError("Couldn't find that spot on the map. Try another result.");
    }
  }, []);

  const closeResults = useCallback(() => setResults([]), []);

  return { query, setQuery: onChange, results, selected, error, select, closeResults };
}

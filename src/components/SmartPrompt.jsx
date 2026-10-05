import { useEffect, useRef, useState } from 'react';
import { extractTripParameters } from '../lib/ai';
import { fetchVietmapPoi } from '../lib/vietmapPoi';
import { searchAddress, geocodeRef } from '../lib/vietmap';
import { Wand2, Loader2 } from 'lucide-react';

const GEMINI_TIMEOUT_MS = 8000;
const VIETMAP_TIMEOUT_MS = 20000;

const cityGeoCache = new Map();

const CITY_ALIASES = {
  hanoi: 'Hanoi',
  'ha noi': 'Hanoi',
  'hà nội': 'Hanoi',
  'ho chi minh': 'Ho Chi Minh City',
  'ho chi minh city': 'Ho Chi Minh City',
  'thanh pho ho chi minh': 'Ho Chi Minh City',
  'thành phố hồ chí minh': 'Ho Chi Minh City',
  hcm: 'Ho Chi Minh City',
  hcmc: 'Ho Chi Minh City',
  danang: 'Da Nang',
  'da nang': 'Da Nang',
  'đà nẵng': 'Da Nang',
};

const CATEGORY_KEYWORDS = [
  ['restaurant', /\b(restaurant|food|eat|dinner|lunch|đồ ăn|ăn uống|nhà hàng)\b/i],
  ['cafe', /\b(cafe|coffee|café|cà phê)\b/i],
  ['museum', /\b(museum|museums|bảo tàng)\b/i],
  ['attraction', /\b(sightseeing|attraction|landmark|tham quan|địa điểm)\b/i],
  ['park', /\b(park|outdoors|nature|công viên|ngoài trời)\b/i],
  ['shopping', /\b(shopping|mall|market|mua sắm|chợ)\b/i],
  ['bar', /\b(bar|pub|nightlife|bia|quán bar)\b/i],
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extractCityLocally(promptText) {
  const normalized = normalizeText(promptText);

  for (const [alias, city] of Object.entries(CITY_ALIASES)) {
    if (normalized.includes(normalizeText(alias))) {
      return city;
    }
  }

  const inCityMatch = promptText.match(
    /\b(?:in|around|near|at|ở|tại|gần)\s+([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ\s-]{1,40}?)(?=\s+(?:on|this|for|with|around|near|in|under|budget|looking|wanting|and|,|\.|$))/i,
  );

  return inCityMatch?.[1]?.trim() || '';
}

function extractBudgetLocally(promptText) {
  const match = promptText.match(
    /(\d[\d.,]*)\s*(k|thousand|000)?\s*(?:vnd|đ|dong)?/i,
  );

  if (!match) return null;

  const rawNumber = match[1].replace(/[.,]/g, '');
  const amount = Number(rawNumber);

  if (!Number.isFinite(amount)) return null;

  const suffix = String(match[2] || '').toLowerCase();

  if (suffix === 'k' || suffix === 'thousand') {
    return amount * 1000;
  }

  return amount;
}

function extractHeadcountLocally(promptText) {
  const match = promptText.match(
    /(?:^|\s)(\d+)\s*(?:of us|people|persons|friends|người|bạn)/i,
  );

  return match ? Number(match[1]) : 1;
}

function extractCategoriesLocally(promptText) {
  const categories = CATEGORY_KEYWORDS
    .filter(([, pattern]) => pattern.test(promptText))
    .map(([category]) => category);

  return categories.length > 0 ? categories : ['attraction', 'cafe'];
}

function extractLocalParameters(promptText) {
  return {
    city: extractCityLocally(promptText),
    budget: extractBudgetLocally(promptText),
    headcount: extractHeadcountLocally(promptText),
    categories: extractCategoriesLocally(promptText),
  };
}

function mergeParameters(localParams, aiParams) {
  return {
    headcount: aiParams?.headcount || localParams.headcount || 1,
    budget: aiParams?.budget ?? localParams.budget,
    city: aiParams?.city || localParams.city,
    categories:
      Array.isArray(aiParams?.categories) && aiParams.categories.length > 0
        ? aiParams.categories
        : localParams.categories,
  };
}

async function geocodeCityCenter(cityName, signal) {
  const key = cityName.toLowerCase().trim();

  if (cityGeoCache.has(key)) {
    return cityGeoCache.get(key);
  }

  const items = await searchAddress(cityName, null, null, null, signal);

  if (!items.length || !items[0].ref_id) {
    cityGeoCache.set(key, null);
    return null;
  }

  const coords = await geocodeRef(items[0].ref_id, signal);
  const result = coords
    ? { lat: Number(coords.lat), lon: Number(coords.lon) }
    : null;

  cityGeoCache.set(key, result);
  return result;
}

function withTimeout(promise, timeoutMs, errorCode) {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error(errorCode));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timer);
  });
}

export default function SmartPrompt({
  onLocationsDiscovered,
  onSearchStateChange,
}) {
  const [prompt, setPrompt] = useState(
    '5 of us wanting to hang out in Hanoi on Saturday afternoon, around 300k VND, food and sightseeing.',
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('');

  const abortControllerRef = useRef(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      runIdRef.current += 1;
    };
  }, []);

  const handleGenerate = async () => {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || isProcessing) return;

    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const { signal } = controller;
    const runId = ++runIdRef.current;
    const localParams = extractLocalParameters(trimmedPrompt);

    const isCurrentRun = () => runId === runIdRef.current;

    if (!localParams.city) {
      onSearchStateChange?.({
        state: 'failed',
        message: 'Please include a city, for example “cafes and museums in Hanoi”.',
      });
      return;
    }

    setIsProcessing(true);
    setStatusText('Reading your plan');

    onSearchStateChange?.({
      state: 'searching',
      message: 'Reading your plan',
    });

    try {
      let aiParams = null;

      try {
        const aiPromise = extractTripParameters(trimmedPrompt);
        aiPromise.catch(() => {});

        aiParams = await withTimeout(
          aiPromise,
          GEMINI_TIMEOUT_MS,
          'GEMINI_TIMEOUT',
        );
      } catch (error) {
        console.warn(
          'Gemini unavailable; continuing with local parameters:',
          error.message,
        );
      }

      if (!isCurrentRun()) return;

      const params = mergeParameters(localParams, aiParams);

      if (!params.city) {
        setIsProcessing(false);
        onSearchStateChange?.({
          state: 'failed',
          message: 'Please include a city, then try again.',
        });
        return;
      }

      setStatusText(`Searching Vietmap around ${params.city}`);

      onSearchStateChange?.({
        state: 'searching',
        message: `Searching Vietmap around ${params.city}`,
      });

      const vietmapPromise = (async () => {
        let cityCenter = null;

        try {
          cityCenter = await geocodeCityCenter(params.city, signal);
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          console.warn(`Could not geocode "${params.city}":`, error);
        }

        return fetchVietmapPoi(
          params.city,
          params.categories,
          cityCenter?.lat ?? null,
          cityCenter?.lon ?? null,
          cityCenter ? 5000 : null,
          signal,
        );
      })();

      vietmapPromise.catch(() => {});

      const places = await withTimeout(
        vietmapPromise,
        VIETMAP_TIMEOUT_MS,
        'VIETMAP_TIMEOUT',
      );

      if (!isCurrentRun()) return;

      if (!places || places.length === 0) {
        setIsProcessing(false);
        setStatusText('');

        onSearchStateChange?.({
          state: 'noPlaces',
          message: `No matching places were found around ${params.city}.`,
        });
        return;
      }

      onLocationsDiscovered(places, params);

      setIsProcessing(false);
      setStatusText('Done');

      window.setTimeout(() => {
        if (runId === runIdRef.current) {
          setStatusText('');
        }
      }, 2500);
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (!isCurrentRun()) return;

      console.error('Vietmap search failed:', error);

      setIsProcessing(false);
      setStatusText('');

      onSearchStateChange?.({
        state: 'failed',
        message:
          error.message === 'VIETMAP_TIMEOUT'
            ? 'Vietmap search took too long. Please try again.'
            : 'Vietmap search failed. Check your connection and try again.',
      });
    }
  };

  return (
    <div className="prompt-card">
      <label htmlFor="trip-prompt">Describe your day</label>

      <textarea
        id="trip-prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="Coffee, museums, local food, and a budget..."
        aria-label="Describe your day"
        disabled={isProcessing}
      />

      <button
        type="button"
        className="primary-button"
        onClick={handleGenerate}
        disabled={isProcessing || !prompt.trim()}
        aria-busy={isProcessing}
      >
        {isProcessing ? (
          <>
            <Loader2 className="spinner" size={16} aria-hidden="true" />
            Searching Vietmap
          </>
        ) : (
          <>
            <Wand2 size={16} aria-hidden="true" />
            Find places
          </>
        )}
      </button>

      {isProcessing && (
        <div className="find-progress" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span>{statusText || 'Searching Vietmap'}</span>
        </div>
      )}
    </div>
  );
}
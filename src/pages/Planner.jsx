import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Sparkles, Hand } from 'lucide-react';
import ItineraryForm from '../components/ItineraryForm';
import MapContainer from '../components/MapContainer';
import RouteOptions from '../components/RouteOptions';
import SmartPrompt from '../components/SmartPrompt';
import { createEmptyTrip } from '../lib/db';
import { getRoute } from '../lib/vietmap';
import './Planner.css';

export default function Planner() {
  const navigate = useNavigate();

  const [locations, setLocations] = useState([]);
  const [travelMode, setTravelMode] = useState('motorcycle');
  const [routes, setRoutes] = useState([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);

  const [isCalculating, setIsCalculating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoMode, setIsAutoMode] = useState(true);

  const [tripParams, setTripParams] = useState(null);
  const [duplicateMsg, setDuplicateMsg] = useState('');
  const [lobbyError, setLobbyError] = useState('');
  const [routeError, setRouteError] = useState('');

  const [searchState, setSearchState] = useState('idle');
  const [searchError, setSearchError] = useState('');

  const checkDuplicate = (newLoc, list) => {
    return list.some((loc) => {
      const locLat = Number(loc.lat);
      const locLon = Number(loc.lon);
      const newLat = Number(newLoc.lat);
      const newLon = Number(newLoc.lon);

      const sameCoords =
        locLat.toFixed(5) === newLat.toFixed(5) &&
        locLon.toFixed(5) === newLon.toFixed(5);

      const latDiff = Math.abs(locLat - newLat);
      const lonDiff = Math.abs(locLon - newLon);
      const isWithin20m = latDiff < 0.0002 && lonDiff < 0.0002;

      const locName = (loc.name || loc.displayName || '').toLowerCase();
      const newName = (newLoc.name || newLoc.displayName || '').toLowerCase();

      return sameCoords || (locName === newName && isWithin20m);
    });
  };

  const handleLocationsDiscovered = (discoveredPlaces, params) => {
    const uniqueLocations = [];
    let hadDuplicates = false;

    discoveredPlaces.forEach((place, index) => {
      const newLoc = {
        id: `${place.lat},${place.lon}-${index}`,
        name: place.name,
        displayName: place.name,
        lat: Number(place.lat),
        lon: Number(place.lon),
        category: place.category,
      };

      if (!checkDuplicate(newLoc, uniqueLocations)) {
        uniqueLocations.push(newLoc);
      } else {
        hadDuplicates = true;
      }
    });

    if (hadDuplicates) {
      setDuplicateMsg('Some duplicate places were skipped.');
      setTimeout(() => setDuplicateMsg(''), 3000);
    } else {
      setDuplicateMsg('');
    }

    setLocations(uniqueLocations.slice(0, 5));
    setTripParams(params);
    setRoutes([]);
    setSelectedRouteIndex(0);
    setRouteError('');
    setSearchState(uniqueLocations.length > 0 ? 'results' : 'noPlaces');
    setSearchError('');
  };

  const handleSearchStateChange = ({ state, message = '' }) => {
    setSearchState(state);
    setSearchError(message);

    if (state === 'searching') {
    } else {
    }

    if (state === 'failed' || state === 'noPlaces') {
      setLocations([]);
      setRoutes([]);
      setSelectedRouteIndex(0);
      setRouteError('');
    }
  };

  const handleCalculateRoute = async () => {
    if (locations.length < 2) return;

    setIsCalculating(true);
    setRoutes([]);
    setSelectedRouteIndex(0);
    setRouteError('');

    try {
      const path = await getRoute(locations, travelMode);

      if (!path) {
        setRouteError("We couldn't calculate a route. Check the stops and try again.");
        return;
      }

      setRoutes([path]);
    } catch (error) {
      console.error('Error calculating route:', error);
      setRouteError("We couldn't calculate a route. Check the stops and try again.");
    } finally {
      setIsCalculating(false);
    }
  };

  const handleCreateLobby = async () => {
    setIsSaving(true);
    setLobbyError('');

    try {
      const tripId = await createEmptyTrip();
      localStorage.setItem(`host_${tripId}`, 'true');
      navigate(`/room/${tripId}`);
    } catch (error) {
      console.error('Failed to save trip:', error);
      setLobbyError('The lobby could not be created. Check your connection and try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRetrySearch = () => {
    setSearchError('');
    setSearchState('idle');
  };

  const handleRetryRoute = () => {
    handleCalculateRoute();
  };

  const hasResults = locations.length > 0;
  const selectedRoute = routes[selectedRouteIndex] || null;

  return (
    <main className="planner-page">
      <aside className="planner-sidebar">
        <div className="planner-mode-switch" aria-label="Planner mode">
          <button
            type="button"
            className={isAutoMode ? 'active' : ''}
            aria-pressed={isAutoMode}
            onClick={() => {
              setIsAutoMode(true);
              setLobbyError('');
            }}
          >
            <Sparkles size={17} aria-hidden="true" />
            Auto-Magic
          </button>

          <button
            type="button"
            className={!isAutoMode ? 'active' : ''}
            aria-pressed={!isAutoMode}
            onClick={() => {
              setIsAutoMode(false);
              setLobbyError('');
            }}
          >
            <Hand size={17} aria-hidden="true" />
            Manual Builder
          </button>
        </div>

        {isAutoMode ? (
          <section className="auto-panel">
            <div className="magic-symbol">
              <Sparkles size={32} aria-hidden="true" />
            </div>

            <h1>Stop guessing.</h1>

            <p>
              Create a lobby, invite your friends, and let everyone add their
              budget and preferences. Datemate builds an itinerary that works
              for the whole group.
            </p>

            {lobbyError && (
              <div className="message message-error" role="alert">
                {lobbyError}
              </div>
            )}

            <button
              type="button"
              className="primary-button"
              disabled={isSaving}
              aria-busy={isSaving}
              onClick={handleCreateLobby}
            >
              {isSaving && <Loader2 className="spinner" size={16} aria-hidden="true" />}
              {isSaving ? 'Creating lobby' : lobbyError ? 'Try again' : 'Start Group Lobby'}
            </button>
          </section>
        ) : (
          <section className="manual-panel">
            <SmartPrompt
              onLocationsDiscovered={handleLocationsDiscovered}
              onSearchStateChange={handleSearchStateChange}
            />

            {searchState === 'failed' && (
              <div className="empty-result-card error-card" role="alert">
                <span className="empty-result-icon">!</span>
                <div>
                  <h2>Couldn't find places</h2>
                  <p>{searchError || 'Check your connection, then try again.'}</p>
                </div>
                <button type="button" onClick={handleRetrySearch}>
                  Try again
                </button>
              </div>
            )}

            {searchState === 'noPlaces' && (
              <div className="empty-result-card">
                <span className="empty-result-icon">0</span>
                <div>
                  <h2>No places found</h2>
                  <p>Try a broader area or fewer preferences.</p>
                </div>
                <button type="button" onClick={handleRetrySearch}>
                  Try again
                </button>
              </div>
            )}

            {tripParams && hasResults && (
              <div className="manual-results">
                <div className="manual-scroll">
                  <div className="summary-chip">
                    <span>
                      <strong>{locations.length}</strong> places
                    </span>

                    {tripParams.budget ? (
                      <>
                        <i />
                        <span>{Number(tripParams.budget).toLocaleString()} VND</span>
                      </>
                    ) : null}

                    <i />
                    <span>{tripParams.city || 'Selected area'}</span>
                  </div>

                  {duplicateMsg && (
                    <div className="message message-warning" role="status">
                      {duplicateMsg}
                    </div>
                  )}

                  <ItineraryForm
                    locations={locations}
                    setLocations={setLocations}
                    travelMode={travelMode}
                    setTravelMode={setTravelMode}
                    onCalculateRoute={handleCalculateRoute}
                    isCalculating={isCalculating}
                    checkDuplicate={checkDuplicate}
                    setDuplicateMsg={setDuplicateMsg}
                  />

                  {routeError && (
                    <div className="route-error-card" role="alert">
                      <span>!</span>
                      <div>
                        <strong>Route couldn't be calculated</strong>
                        <small>{routeError}</small>
                      </div>
                      <button type="button" onClick={handleRetryRoute}>
                        Retry
                      </button>
                    </div>
                  )}

                  {routes.length > 0 && (
                    <RouteOptions
                      routes={routes}
                      selectedRouteIndex={selectedRouteIndex}
                      setSelectedRouteIndex={setSelectedRouteIndex}
                    />
                  )}
                </div>
              </div>
            )}

          </section>
        )}
      </aside>

      <section className="planner-map-panel">
        <MapContainer
          locations={!isAutoMode ? locations : []}
          routeGeometry={!isAutoMode ? selectedRoute?.geometry : null}
        />

        <div className="map-caption">
          <span className="map-caption-icon">
            <Sparkles size={17} aria-hidden="true" />
          </span>
          <span>
            <strong>
              {isAutoMode
                ? "Your group's route will appear after everyone joins."
                : locations.length
                  ? `${locations.length} places selected`
                  : 'Your places will appear here'}
            </strong>
            {!isAutoMode && (
              <small>
                {selectedRoute ? 'Route preview ready' : 'Add stops to build your route'}
              </small>
            )}
          </span>
        </div>
      </section>
    </main>
  );
}
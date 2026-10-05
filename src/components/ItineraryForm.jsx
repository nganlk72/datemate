import { Search, Trash2, Navigation, MapPin } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useState } from 'react';
import { searchAddress, geocodeRef } from '../lib/vietmap';

function getLocationName(location) {
  return location.name || location.displayName || 'Unnamed place';
}

function getLocationType(location) {
  return location.category || 'Place';
}

export default function ItineraryForm({
  locations,
  setLocations,
  travelMode,
  setTravelMode,
  onCalculateRoute,
  isCalculating,
  checkDuplicate,
  setDuplicateMsg,
}) {
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);

  const handleSearch = async (query) => {
    const trimmedQuery = query.trim();

    if (!trimmedQuery || isSearching || isGeocoding) return;

    setIsSearching(true);

    try {
      const results = await searchAddress(trimmedQuery);
      setSearchResults(results);
    } catch (error) {
      console.error('Error searching location:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const addLocation = async (result) => {
    if (isGeocoding) return;

    setIsGeocoding(true);

    try {
      const details = await geocodeRef(result.ref_id);

      if (!details) {
        setDuplicateMsg?.('Could not find coordinates for this location.');
        window.setTimeout(() => setDuplicateMsg?.(''), 3000);
        return;
      }

      const newLocation = {
        id: crypto.randomUUID(),
        name: details.display_name || result.display_name,
        displayName: details.display_name || result.display_name,
        lat: Number(details.lat),
        lon: Number(details.lon),
        category: 'place',
      };

      if (checkDuplicate?.(newLocation, locations)) {
        setDuplicateMsg?.('That stop is already in your itinerary.');
        window.setTimeout(() => setDuplicateMsg?.(''), 3000);
        return;
      }

      setLocations((current) => [...current, newLocation]);
      setSearchInput('');
      setSearchResults([]);
    } catch (error) {
      console.error('Geocoding failed:', error);
      setDuplicateMsg?.('Could not add this place. Please try again.');
      window.setTimeout(() => setDuplicateMsg?.(''), 3000);
    } finally {
      setIsGeocoding(false);
    }
  };

  const removeLocation = (id) => {
    setLocations((current) => current.filter((location) => location.id !== id));
  };

  const moveLocation = (index, direction) => {
    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= locations.length) return;

    setLocations((current) => {
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;

    const items = Array.from(locations);
    const [reorderedItem] = items.splice(result.source.index, 1);

    items.splice(result.destination.index, 0, reorderedItem);
    setLocations(items);
  };

  const travelModes = [
    { id: 'car', label: 'Car', icon: '🚗' },
    { id: 'motorcycle', label: 'Motorbike', icon: '🛵' },
    { id: 'foot', label: 'Walk', icon: '🚶' },
  ];

  return (
    <>
      <div className="stops-card">
        <div className="section-heading">
          <div>
            <h2>Your stops</h2>
            <p>Reorder or remove places before routing.</p>
          </div>
          <span>{locations.length}</span>
        </div>

        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="locations-list">
            {(provided) => (
              <div
                className="stop-list"
                ref={provided.innerRef}
                {...provided.droppableProps}
              >
                {locations.length === 0 ? (
                  <p className="stop-list-empty">No places added yet.</p>
                ) : (
                  locations.map((location, index) => {
                    const name = getLocationName(location);
                    const type = getLocationType(location);

                    return (
                      <Draggable
                        key={location.id}
                        draggableId={String(location.id)}
                        index={index}
                      >
                        {(providedDraggable, snapshot) => (
                          <div
                            ref={providedDraggable.innerRef}
                            {...providedDraggable.draggableProps}
                            className={`stop-row ${
                              snapshot.isDragging ? 'dragging' : ''
                            }`}
                          >
                            <button
                              type="button"
                              className="drag-handle"
                              {...providedDraggable.dragHandleProps}
                              aria-label={`Drag to reorder ${name}`}
                            >
                              ⠿
                            </button>

                            <span className="stop-number">{index + 1}</span>

                            <span className="stop-copy">
                              <strong title={name}>{name}</strong>
                              <small>{type}</small>
                            </span>

                            <span className="reorder-controls">
                              <button
                                type="button"
                                onClick={() => moveLocation(index, -1)}
                                disabled={index === 0}
                                aria-label={`Move ${name} up`}
                              >
                                ↑
                              </button>

                              <button
                                type="button"
                                onClick={() => moveLocation(index, 1)}
                                disabled={index === locations.length - 1}
                                aria-label={`Move ${name} down`}
                              >
                                ↓
                              </button>

                              <button
                                type="button"
                                className="remove-button"
                                onClick={() => removeLocation(location.id)}
                                aria-label={`Remove ${name}`}
                              >
                                <Trash2 size={16} aria-hidden="true" />
                              </button>
                            </span>
                          </div>
                        )}
                      </Draggable>
                    );
                  })
                )}

                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>

        <div className="place-search">
          <Search className="search-icon" size={16} aria-hidden="true" />

          <input
            type="text"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleSearch(searchInput);
              }
            }}
            placeholder="Search for another place"
            aria-label="Search for another place"
            disabled={isGeocoding}
          />

          {isSearching && (
            <span className="spinner search-spinner" aria-hidden="true" />
          )}

          {searchResults.length > 0 && (
            <div className="place-results">
              {searchResults.map((result, index) => {
                const [title, ...addressParts] = (
                  result.display_name || ''
                ).split(',');

                return (
                  <button
                    type="button"
                    key={result.ref_id || `${result.display_name}-${index}`}
                    onClick={() => addLocation(result)}
                    disabled={isGeocoding}
                  >
                    <span className="result-pin">
                      <MapPin size={15} aria-hidden="true" />
                    </span>

                    <span>
                      <strong>{title || result.display_name}</strong>
                      {addressParts.length > 0 && (
                        <small>{addressParts.join(',').trim()}</small>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="route-builder">
        <label>Travel mode</label>

        <div className="travel-switch" aria-label="Travel mode">
          {travelModes.map((mode) => (
            <button
              type="button"
              key={mode.id}
              className={travelMode === mode.id ? 'active' : ''}
              aria-pressed={travelMode === mode.id}
              onClick={() => setTravelMode(mode.id)}
            >
              <span aria-hidden="true">{mode.icon}</span>
              {mode.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="primary-button calculate-button"
          onClick={onCalculateRoute}
          disabled={locations.length < 2 || isCalculating}
          aria-busy={isCalculating}
        >
          {isCalculating && (
            <span className="spinner" aria-hidden="true" />
          )}

          {isCalculating
            ? 'Calculating route'
            : locations.length < 2
              ? 'Add at least 2 places'
              : 'Calculate route'}
        </button>
      </div>
    </>
  );
}
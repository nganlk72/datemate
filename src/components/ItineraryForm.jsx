import { useState } from 'react';
import axios from 'axios';
import { MapPin, Search, Plus, Trash2, Navigation } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

import { searchAddress, geocodeRef } from '../lib/vietmap';

export default function ItineraryForm({ 
  locations, 
  setLocations, 
  travelMode, 
  setTravelMode,
  onCalculateRoute,
  isCalculating
}) {
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);

  const handleSearch = async (query) => {
    if (!query) return;
    setIsSearching(true);
    try {
      const results = await searchAddress(query);
      setSearchResults(results);
    } catch (error) {
      console.error("Error searching location:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const addLocation = async (result) => {
    setIsGeocoding(true);
    try {
      const details = await geocodeRef(result.ref_id);
      if (details) {
        const newLocation = {
          id: Date.now().toString(),
          displayName: details.display_name,
          lat: parseFloat(details.lat),
          lon: parseFloat(details.lon)
        };
        setLocations([...locations, newLocation]);
        setSearchInput('');
        setSearchResults([]);
      } else {
        alert("Could not find coordinates for this location.");
      }
    } catch (error) {
      console.error("Geocoding failed:", error);
    } finally {
      setIsGeocoding(false);
    }
  };

  const removeLocation = (id) => {
    setLocations(locations.filter(loc => loc.id !== id));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(locations);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setLocations(items);
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-md flex flex-col h-full overflow-y-auto">
      <h2 className="text-xl font-bold mb-4 flex items-center">
        <Navigation className="mr-2" /> Plan Itinerary
      </h2>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">Travel Mode</label>
        <div className="flex space-x-2">
          {[
            { id: 'car', label: 'Car 🚗' },
            { id: 'motorcycle', label: 'Motorbike 🛵' },
            { id: 'foot', label: 'Walking 🚶' }
          ].map((mode) => (
            <button
              key={mode.id}
              onClick={() => setTravelMode(mode.id)}
              className={`flex-1 py-2 px-1 rounded text-sm font-medium transition ${
                travelMode === mode.id 
                  ? 'bg-blue-600 text-white shadow' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex-1">
        <label className="block text-sm font-medium text-gray-700 mb-2">Destinations</label>
        {locations.length === 0 ? (
          <p className="text-gray-500 text-sm mb-4">No locations added yet.</p>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="locations-list">
              {(provided) => (
                <ul {...provided.droppableProps} ref={provided.innerRef} className="space-y-2 mb-4">
                  {locations.map((loc, index) => (
                    <Draggable key={loc.id} draggableId={loc.id} index={index}>
                      {(provided, snapshot) => (
                        <li 
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          className={`flex items-start justify-between p-2 rounded border text-sm ${snapshot.isDragging ? 'bg-blue-100 shadow-md' : 'bg-white'}`}
                        >
                          <div className="flex items-start cursor-grab">
                            <span className="font-bold mr-2 text-blue-600">{index + 1}.</span>
                            <span className="truncate max-w-[200px]" title={loc.displayName}>{loc.displayName}</span>
                          </div>
                          <button onClick={() => removeLocation(loc.id)} className="text-red-500 hover:text-red-700 ml-2">
                            <Trash2 size={16} />
                          </button>
                        </li>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </ul>
              )}
            </Droppable>
          </DragDropContext>
        )}

        <div className="relative">
          <div className="flex">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchInput)}
              placeholder="Search place..."
              className="flex-1 border rounded-l px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              disabled={isGeocoding}
            />
            <button 
              onClick={() => handleSearch(searchInput)}
              disabled={isSearching || isGeocoding}
              className="bg-blue-500 text-white px-3 py-2 rounded-r hover:bg-blue-600 disabled:bg-blue-300"
            >
              {isSearching ? <span className="animate-pulse">...</span> : <Search size={16} />}
            </button>
          </div>
          
          {searchResults.length > 0 && (
            <ul className="absolute z-20 w-full bg-white border mt-1 max-h-60 overflow-y-auto shadow-lg rounded">
              {searchResults.map((result, idx) => (
                <li 
                  key={idx} 
                  onClick={() => addLocation(result)}
                  className={`p-2 border-b hover:bg-gray-100 cursor-pointer text-sm ${isGeocoding ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  {result.display_name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <button
        onClick={onCalculateRoute}
        disabled={locations.length < 2 || isCalculating}
        className="w-full bg-green-600 text-white font-bold py-3 rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed mt-4"
      >
        {isCalculating ? 'Calculating...' : 'Calculate Route'}
      </button>
    </div>
  );
}

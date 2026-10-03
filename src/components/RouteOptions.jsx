export default function RouteOptions({ routes, selectedRouteIndex, setSelectedRouteIndex }) {
  if (!routes || routes.length === 0) return null;

  const formatDuration = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  };

  const formatDistance = (meters) => {
    const km = meters / 1000;
    return `${km.toFixed(1)} km`;
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-md mt-4">
      <h3 className="font-bold mb-3">Route Options</h3>
      <div className="space-y-2">
        {routes.map((route, index) => (
          <div 
            key={index}
            onClick={() => setSelectedRouteIndex(index)}
            className={`p-3 rounded border cursor-pointer flex justify-between items-center ${
              selectedRouteIndex === index ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <div>
              <span className="font-bold text-lg">{formatDuration(route.duration)}</span>
              <div className="text-sm text-gray-500">{formatDistance(route.distance)}</div>
            </div>
            {selectedRouteIndex === index && (
              <span className="bg-blue-500 text-white text-xs px-2 py-1 rounded">Selected</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

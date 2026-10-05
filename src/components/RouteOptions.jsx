function formatDuration(seconds) {
  const value = Number(seconds);

  if (!Number.isFinite(value) || value < 0) {
    return '—';
  }

  const hours = Math.floor(value / 3600);
  const minutes = Math.round((value % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes} min`;
}

function formatDistance(meters) {
  const value = Number(meters);

  if (!Number.isFinite(value) || value < 0) {
    return '—';
  }

  const kilometers = value / 1000;
  return `${kilometers.toFixed(1)} km`;
}

export default function RouteOptions({
  routes,
  selectedRouteIndex,
  setSelectedRouteIndex,
}) {
  if (!Array.isArray(routes) || routes.length === 0) {
    return null;
  }

  return (
    <section className="route-options" aria-label="Route options">
      <div className="section-heading compact">
        <div>
          <h2>Your route</h2>
          <p>Select a route to show it on the map.</p>
        </div>
      </div>

      {routes.map((route, index) => {
        const isSelected = selectedRouteIndex === index;

        return (
          <button
            type="button"
            key={route.id || index}
            className={`route-card ${isSelected ? 'active' : ''}`}
            onClick={() => setSelectedRouteIndex(index)}
            aria-pressed={isSelected}
          >
            <span>
              <strong>{formatDuration(route.duration)}</strong>
              <small>{formatDistance(route.distance)}</small>
            </span>

            {isSelected && <i>Shown on map</i>}
          </button>
        );
      })}
    </section>
  );
}
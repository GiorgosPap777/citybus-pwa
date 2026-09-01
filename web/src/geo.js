const EARTH_RADIUS_M = 6371000;

const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceMetres(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Nearest `limit` stops to `origin`, each annotated with its distance. */
export function nearestStops(stops, origin, limit = 8) {
  return stops
    .map((stop) => ({
      ...stop,
      distance: distanceMetres(origin, { lat: stop.latitude, lon: stop.longitude }),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

export function formatDistance(metres, t) {
  if (metres < 1000) return t('metresAway', { n: Math.round(metres / 10) * 10 });
  return t('kmAway', { n: (metres / 1000).toFixed(1) });
}

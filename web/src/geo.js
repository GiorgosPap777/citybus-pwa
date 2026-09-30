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
  const km = metres / 1000;
  return t('kmAway', { n: km < 10 ? km.toFixed(1) : Math.round(km) });
}

/** Metres from a point to a [south, west, north, east] box; 0 inside it. */
export function distanceToBounds(point, [south, west, north, east]) {
  const lat = Math.min(north, Math.max(south, point.lat));
  const lon = Math.min(east, Math.max(west, point.lon));
  return distanceMetres(point, { lat, lon });
}

// Farther than this from every stop, the user is not in the chosen city. Reported:
// Chania chosen, the user in Athens, and "Near me" listed stops 272 km away.
export const FAR_FROM_CITY_M = 20_000;
// Close enough to another city's stops to offer it instead.
const NEAR_CITY_M = 10_000;

/** The city whose stops are nearest the user, if within reach, other than `current`. */
export function nearestCity(cities, position, current) {
  let best = null;
  for (const city of cities) {
    if (city.slug === current || city.noData || !Array.isArray(city.bounds)) continue;
    const distance = distanceToBounds(position, city.bounds);
    if (distance <= NEAR_CITY_M && (!best || distance < best.distance)) best = { city, distance };
  }
  return best?.city ?? null;
}

// Metres from p to the straight line between stops a and b, on a local flat
// projection, which is plenty at the few hundred metres between two stops.
function distanceToSegment(p, a, b) {
  const k = Math.cos(toRad(p.lat)) * EARTH_RADIUS_M;
  const r = EARTH_RADIUS_M;
  const ax = toRad(a.lon) * k, ay = toRad(a.lat) * r;
  const dx = toRad(b.lon) * k - ax, dy = toRad(b.lat) * r - ay;
  const px = toRad(p.lon) * k - ax, py = toRad(p.lat) * r - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq)) : 0;
  return Math.hypot(px - t * dx, py - t * dy);
}

// A bus farther than this from its route is not on it yet (leaving the depot) or
// its position is off. The line between two stops cuts corners the road does not,
// so this allows for a bend.
const MAX_OFF_ROUTE_M = 300;

/**
 * Where a bus is along its route: `passed`, the index in `sequence` of the last
 * stop it has left, and `stopsAway`, how many stops it calls at up to and
 * including `targetCode` (1 = the next one). null when it cannot be told: no GPS
 * fix, or the bus is not near its route.
 *
 * The bus is placed on the stretch between two consecutive stops it lies closest
 * to. Only stretches before the user's stop count: the stop is listing the bus
 * because it is coming. That also settles a circular route (Chania's start and
 * end at the same stop), where the terminus is both behind the bus and ahead of it.
 */
export function routeProgress(sequence, stopsByCode, vehicle, targetCode) {
  if (!sequence?.length || !vehicle?.hasPosition) return null;
  const position = { lat: vehicle.latitude, lon: vehicle.longitude };
  let best = null;
  for (let i = 0; i < sequence.length - 1; i += 1) {
    const a = stopsByCode.get(sequence[i]);
    const b = stopsByCode.get(sequence[i + 1]);
    const target = sequence.indexOf(targetCode, i + 1);
    if (!a || !b || target === -1) continue;
    const distance = distanceToSegment(
      position,
      { lat: a.latitude, lon: a.longitude },
      { lat: b.latitude, lon: b.longitude },
    );
    if (!best || distance < best.distance) best = { passed: i, stopsAway: target - i, distance };
  }
  return best && best.distance <= MAX_OFF_ROUTE_M
    ? { passed: best.passed, stopsAway: best.stopsAway }
    : null;
}

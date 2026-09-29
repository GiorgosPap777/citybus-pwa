import { useEffect, useState } from 'react';
import { fetchRouteShape } from '../api.js';

/**
 * The street path of one route, as [[lat, lon], …], or null. A shape that fails
 * to load is simply not drawn — it is decoration on top of the arrivals, not
 * something worth an error message. Keyed like useStops so a stale shape from the
 * previously focused bus is never drawn under the new one.
 */
export function useRouteShape(city, lineCode, routeCode) {
  const [state, setState] = useState({ key: null, points: null });
  const key = lineCode && routeCode ? `${city}:${lineCode}:${routeCode}` : null;

  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    fetchRouteShape(city, lineCode, routeCode, controller.signal)
      .then((shape) => setState({ key, points: shape.points }))
      .catch((err) => {
        if (err.name !== 'AbortError') setState({ key, points: null });
      });
    return () => controller.abort();
  }, [city, lineCode, routeCode, key]);

  return key !== null && state.key === key ? state.points : null;
}

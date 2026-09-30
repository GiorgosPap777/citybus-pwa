import { useEffect, useState } from 'react';
import { fetchRouteSequence } from '../api.js';

/**
 * The stop codes one route calls at, in order, or null. Like the route's shape it
 * only adds to what is on screen, so a failure is not reported: the map falls back
 * to the stops' own route lists. Keyed so a previous bus's route is never used.
 */
export function useRouteSequence(city, routeCode) {
  const [state, setState] = useState({ key: null, stops: null });
  const key = routeCode ? `${city}:${routeCode}` : null;

  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    fetchRouteSequence(city, routeCode, controller.signal)
      .then((sequence) => setState({ key, stops: sequence.stops }))
      .catch((err) => {
        if (err.name !== 'AbortError') setState({ key, stops: null });
      });
    return () => controller.abort();
  }, [city, routeCode, key]);

  return key !== null && state.key === key ? state.stops : null;
}

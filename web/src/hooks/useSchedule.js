import { useEffect, useState } from 'react';
import { fetchSchedule } from '../api.js';

/**
 * Timetabled departures for one stop, fetched once each time `enabled` turns on.
 * The caller enables it only when live arrivals come back empty, so opening a
 * busy stop costs no extra request.
 *
 * Like useStops, it never hands out another stop's data: for the render between
 * a stop change and the fetch starting, `state` still holds the previous stop.
 */
export function useSchedule(city, lang, stopCode, enabled) {
  const [state, setState] = useState({ key: null, data: null, error: null });
  const key = stopCode ? `${city}:${lang}:${stopCode}` : null;

  useEffect(() => {
    if (!enabled || !key) return undefined;
    const controller = new AbortController();
    fetchSchedule(city, lang, stopCode, controller.signal)
      .then((data) => setState({ key, data, error: null }))
      .catch((err) => {
        if (err.name !== 'AbortError') setState({ key, data: null, error: err });
      });
    return () => controller.abort();
  }, [city, lang, stopCode, enabled, key]);

  const isCurrent = key !== null && state.key === key;
  return {
    data: isCurrent ? state.data : null,
    error: isCurrent ? state.error : null,
    loading: enabled && !isCurrent,
  };
}

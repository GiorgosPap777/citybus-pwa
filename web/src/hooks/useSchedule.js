import { useCallback, useEffect, useState } from 'react';
import { fetchSchedule } from '../api.js';

// With this many live buses or fewer, the timetable fits beside them and opens by
// itself. A busier stop keeps it behind its toggle.
const FEW_BUSES = 3;

/**
 * Whether a stop's timetable is shown, and a toggle for it. With no live buses it
 * is the only answer to "when is the next bus?", so it is always shown.
 *
 * Otherwise the default is settled once per stop, from its first live answer: a
 * count hovering around FEW_BUSES would open and close the timetable between
 * polls. The user's toggle replaces the default until another stop is opened.
 */
export function useTimetableShown(stopKey, liveCount) {
  const [choice, setChoice] = useState({ key: null, shown: false });
  const settled = stopKey !== null && choice.key === stopKey;
  const byDefault = liveCount !== null && liveCount <= FEW_BUSES;
  const shown = liveCount === 0 || (settled ? choice.shown : byDefault);

  useEffect(() => {
    if (!settled && stopKey !== null && liveCount !== null) {
      setChoice({ key: stopKey, shown: byDefault });
    }
  }, [settled, stopKey, liveCount, byDefault]);

  const toggle = useCallback(() => setChoice({ key: stopKey, shown: !shown }), [stopKey, shown]);
  return [shown, toggle];
}

/**
 * Timetabled departures for one stop, fetched once each time `enabled` turns on.
 * The caller enables it only while the timetable is shown (see useTimetableShown),
 * so opening a busy stop costs no extra request.
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

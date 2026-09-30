import { useCallback, useEffect, useRef, useState } from 'react';
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

// Fetch the next departures again once fewer than this many are still to come.
const REFILL_AT = 3;
// A departure stays listed this long after its time (StopSheet drops it after).
const PASSED_GRACE_MS = 60_000;
// Never refetch sooner than this after the last fetch, whatever the list says.
const MIN_REFETCH_MS = 60_000;
// Nor let a list with nothing left to count down sit longer than this.
const MAX_AGE_MS = 30 * 60_000;
// After a failed fetch, try again after this, doubling up to the cap.
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 2 * 60_000;

/**
 * Timetabled departures for one stop, fetched while `enabled`. The caller enables
 * it only while the timetable is shown (see useTimetableShown), so opening a busy
 * stop costs no extra request.
 *
 * Like useStops, it never hands out another stop's data: for the render between
 * a stop change and the fetch starting, `state` still holds the previous stop.
 */
export function useSchedule(city, lang, stopCode, enabled) {
  const [state, setState] = useState({ key: null, data: null, error: null, receivedAt: 0 });
  const [version, setVersion] = useState(0);
  const key = stopCode ? `${city}:${lang}:${stopCode}` : null;
  const failures = useRef(0);

  useEffect(() => {
    if (!enabled || !key) return undefined;
    const controller = new AbortController();
    fetchSchedule(city, lang, stopCode, controller.signal)
      .then((data) => {
        failures.current = 0;
        setState({ key, data, error: null, receivedAt: Date.now() });
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        failures.current += 1;
        // A failed refetch keeps the list it had. Replacing it with the error took
        // away the one useful thing on screen while live data was failing too.
        setState((prev) =>
          prev.key === key ? { ...prev, error: err } : { key, data: null, error: err, receivedAt: 0 },
        );
      });
    return () => controller.abort();
  }, [city, lang, stopCode, enabled, key, version]);

  useEffect(() => {
    failures.current = 0;
  }, [key]);

  const refresh = useCallback(() => setVersion((n) => n + 1), []);

  const isCurrent = key !== null && state.key === key;
  const data = isCurrent ? state.data : null;
  const error = isCurrent ? state.error : null;
  const { receivedAt } = state;

  // A failure is retried by itself, as useStops does: with backoff, and at once
  // when the phone is back online or the app back in view. It was final: after the
  // network returned, the timetable said "offline" until the user toggled it.
  // Keyed on the error object, a new one per failure (see useStops for why).
  useEffect(() => {
    if (!enabled || !error) return undefined;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures.current - 1));
    const timer = setTimeout(refresh, delay);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, error, refresh]);

  // The list is "the next 8 from when it was fetched", and it runs down: a busy
  // stop's eight cover about 20 minutes. Fetched once, it emptied while the stop
  // stayed open, and a phone pocketed with a stop open came back to times all
  // dropped as passed, which then read as "no more departures". So fetch again
  // when it runs low, or on returning to the app once that point is past. The
  // server keeps day timetables for 12 hours, so this seldom reaches the upstream.
  useEffect(() => {
    // While a fetch is failing, the retry above does the refetching.
    if (!enabled || !data || error) return undefined;
    const { departures } = data;
    const runsLowAt = departures.length
      ? departures[Math.max(0, departures.length - REFILL_AT)].departsAt + PASSED_GRACE_MS
      : Infinity;
    // The floor is timed from this device's clock, not the server's fetchedAt: a
    // phone whose clock runs ahead would otherwise find every fresh list overdue
    // and refetch in a loop.
    const due = Math.max(receivedAt + MIN_REFETCH_MS, Math.min(runsLowAt, receivedAt + MAX_AGE_MS));

    // Hidden, the page waits: the visibility handler catches up on return.
    const refetchIfDue = () => {
      if (!document.hidden && Date.now() >= due) refresh();
    };
    const timer = setTimeout(refetchIfDue, Math.max(0, due - Date.now()));
    document.addEventListener('visibilitychange', refetchIfDue);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', refetchIfDue);
    };
  }, [enabled, data, error, receivedAt, refresh]);

  return {
    data,
    error,
    loading: enabled && !isCurrent,
    refresh,
  };
}

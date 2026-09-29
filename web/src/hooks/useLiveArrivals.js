import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLiveArrivals } from '../api.js';

const POLL_MS = 15000;
// Floor between two network fetches, however many resume events arrive.
const MIN_REFRESH_GAP_MS = 3000;

/**
 * Polls one stop's arrivals while it is open.
 *
 * Polling stops entirely while the tab is hidden and resumes with an immediate
 * fetch — a backgrounded phone should not be firing requests every 15s, and the
 * data on return is stale enough that waiting for the next tick would show wrong
 * minute counts.
 */
export function useLiveArrivals(city, lang, stopCode, intervalMs = POLL_MS) {
  const [state, setState] = useState({ key: null, data: null, error: null, loading: false, refreshing: false });
  const key = stopCode ? `${city}:${lang}:${stopCode}` : null;
  const [nonce, setNonce] = useState(0);
  const hasData = useRef(false);

  useEffect(() => {
    hasData.current = false;
    if (!stopCode) {
      setState({ key: null, data: null, error: null, loading: false, refreshing: false });
      return undefined;
    }

    let cancelled = false;
    let timer = null;
    let inFlight = false;
    let wasHidden = document.hidden;
    let lastFetchAt = 0;
    const controller = new AbortController();

    const load = async () => {
      lastFetchAt = Date.now();
      // Only show a blocking spinner on the first load; later polls refresh quietly.
      setState((prev) =>
        hasData.current
          ? { ...prev, refreshing: true }
          : { key, data: null, error: null, loading: true, refreshing: false },
      );
      try {
        const data = await fetchLiveArrivals(city, lang, stopCode, controller.signal);
        if (cancelled) return;
        hasData.current = true;
        setState({ key, data, error: null, loading: false, refreshing: false });
      } catch (err) {
        if (cancelled || err.name === 'AbortError') return;
        // Keep the last good data on screen; a dropped poll should not blank the list.
        setState((prev) => ({ ...prev, error: err, loading: false, refreshing: false }));
      }
    };

    const scheduleNext = () => {
      clearTimeout(timer);
      if (!document.hidden) timer = setTimeout(cycle, intervalMs);
    };

    // Every entry point funnels through here, and each one cancels the pending
    // timer first. Without that, a foreground/background cycle leaves the old
    // chain running alongside the new one and the poll rate multiplies with every
    // app switch — which on a phone is constant.
    const cycle = async () => {
      clearTimeout(timer);
      if (inFlight) return; // the running fetch will reschedule when it settles
      inFlight = true;
      try {
        await load();
      } finally {
        inFlight = false;
      }
      if (!cancelled) scheduleNext();
    };

    // Only a real hidden -> visible transition should force a refresh. Some
    // environments fire visibilitychange repeatedly without the state actually
    // changing, and reacting to each one turns a 15s poll into a request flood.
    const onVisibilityChange = () => {
      const isHidden = document.hidden;
      if (isHidden === wasHidden) return;
      wasHidden = isHidden;

      if (isHidden) {
        clearTimeout(timer);
      } else if (Date.now() - lastFetchAt < MIN_REFRESH_GAP_MS) {
        scheduleNext(); // fetched a moment ago; just restart the timer
      } else {
        cycle();
      }
    };

    cycle();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [city, lang, stopCode, intervalMs, nonce, key]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // Like useStops: for the render between a stop change and the fetch starting,
  // `state` still holds the previous stop's arrivals. Anything deciding from them
  // (the timetable's default, the map's buses) would act on the wrong stop.
  const current =
    state.key === key ? state : { data: null, error: null, loading: key !== null, refreshing: false };
  return { ...current, refresh };
}

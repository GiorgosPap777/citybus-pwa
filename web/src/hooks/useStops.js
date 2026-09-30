import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStops } from '../api.js';

// First automatic retry after a failed load, doubling up to the cap.
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

export function useStops(city, lang) {
  const [state, setState] = useState({
    stops: [],
    city: null,
    lang: null,
    loading: true,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ stops: [], city: null, lang: null, loading: true, error: null });

    fetchStops(city, lang, controller.signal)
      .then((stops) => {
        failures.current = 0;
        setState({ stops, city, lang, loading: false, error: null });
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        failures.current += 1;
        setState({ stops: [], city, lang, loading: false, error: err });
      });

    return () => controller.abort();
  }, [city, lang, attempt]);

  useEffect(() => {
    failures.current = 0;
  }, [city, lang]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // React re-renders with the new city one tick before the effect above replaces
  // the data, so for that tick `state` still holds the previous city's stops.
  // Handing those out lets callers act on the wrong city — the map frames itself
  // on it and then considers the new city already done. Withhold them instead.
  const isCurrent = state.city === city && state.lang === lang;
  const error = isCurrent ? state.error : null;

  // A failed load used to be final: flaky mobile data, or the server restarting
  // for a deploy, left the app without stops until it was killed — an installed
  // app has no reload button. So retry with backoff, and at once when the phone
  // comes back online or the app back into view. A 404 is a city without data,
  // which no retry will change.
  // Keyed on the error itself, a new object per failure. A flag would not re-arm
  // after a failure that answers at once: React batches its "loading" and "failed"
  // states into one render, the flag never changes, and retrying stops after one.
  useEffect(() => {
    if (!error || error.status === 404) return undefined;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures.current - 1));
    const timer = setTimeout(retry, delay);
    const onVisible = () => {
      if (!document.hidden) retry();
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [error, retry]);

  return {
    stops: isCurrent ? state.stops : [],
    loading: !isCurrent || state.loading,
    error,
    retry,
  };
}

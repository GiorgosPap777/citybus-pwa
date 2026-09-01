import { useEffect, useState } from 'react';
import { fetchStops } from '../api.js';

export function useStops(city, lang) {
  const [state, setState] = useState({
    stops: [],
    city: null,
    lang: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({ stops: [], city: null, lang: null, loading: true, error: null });

    fetchStops(city, lang, controller.signal)
      .then((stops) => setState({ stops, city, lang, loading: false, error: null }))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setState({ stops: [], city, lang, loading: false, error: err });
      });

    return () => controller.abort();
  }, [city, lang]);

  // React re-renders with the new city one tick before the effect above replaces
  // the data, so for that tick `state` still holds the previous city's stops.
  // Handing those out lets callers act on the wrong city — the map frames itself
  // on it and then considers the new city already done. Withhold them instead.
  const isCurrent = state.city === city && state.lang === lang;

  return {
    stops: isCurrent ? state.stops : [],
    loading: !isCurrent || state.loading,
    error: isCurrent ? state.error : null,
  };
}

import { useCallback, useState } from 'react';

export function useGeolocation() {
  const [state, setState] = useState({ position: null, error: null, status: 'idle' });

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState({ position: null, error: 'unavailable', status: 'error' });
      return;
    }
    // Browsers only expose geolocation over HTTPS (localhost excepted), and the
    // failure is otherwise silent, so name it explicitly.
    if (!window.isSecureContext) {
      setState({ position: null, error: 'insecure', status: 'error' });
      return;
    }

    setState((prev) => ({ ...prev, status: 'locating' }));
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setState({
          position: {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          },
          error: null,
          status: 'ready',
        }),
      (err) =>
        setState({
          position: null,
          error: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable',
          status: 'error',
        }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }, []);

  return { ...state, request };
}

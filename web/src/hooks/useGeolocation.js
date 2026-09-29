import { useCallback, useEffect, useState } from 'react';

const WATCH_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 };

/**
 * Follows the user's position once they ask for it, so "Near me" and the location
 * dot keep up as they walk to the stop.
 *
 * The watch is dropped whenever the app is hidden and restarted on return: a GPS
 * watch left running in a backgrounded tab is the biggest battery cost a web app
 * can impose, and a phone with this app installed is backgrounded most of the day.
 */
export function useGeolocation() {
  const [state, setState] = useState({ position: null, error: null, status: 'idle' });
  const [watching, setWatching] = useState(false);

  useEffect(() => {
    if (!watching) return undefined;
    let watchId = null;

    const onFix = (pos) =>
      setState({
        position: {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        },
        error: null,
        status: 'ready',
      });

    const onError = (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        stop();
        setState({ position: null, error: 'denied', status: 'error' });
        setWatching(false); // so a later tap can ask again
        return;
      }
      // Timeouts and lost signal are routine mid-walk; keep showing the last fix.
      setState((prev) =>
        prev.position ? prev : { position: null, error: 'unavailable', status: 'error' },
      );
    };

    const start = () => {
      if (watchId === null) {
        watchId = navigator.geolocation.watchPosition(onFix, onError, WATCH_OPTIONS);
      }
    };
    function stop() {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    const onVisibilityChange = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [watching]);

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
    setState((prev) => (prev.position ? prev : { ...prev, error: null, status: 'locating' }));
    setWatching(true);
  }, []);

  return { ...state, request };
}

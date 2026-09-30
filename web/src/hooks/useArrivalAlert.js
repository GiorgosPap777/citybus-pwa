import { useCallback, useEffect, useRef } from 'react';
import { useLiveArrivals } from './useLiveArrivals.js';

// Minutes of warning the user can choose from, in settings.
export const ALERT_LEADS = [2, 5, 10];
export const DEFAULT_ALERT_LEAD = 5;
export const asAlertLead = (value) => (ALERT_LEADS.includes(value) ? value : null);

// A bus missing from this many answers in a row has gone, or the feed has lost it.
// One missing answer is not enough: the feed drops a bus now and then.
const LOST_AFTER_POLLS = 3;

const VIBRATION = [300, 150, 300];

async function showNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const options = { body, tag: 'citybus-alert', renotify: true, icon: '/icon-192.png', vibrate: VIBRATION };
  // Android allows notifications only through the service worker; the constructor
  // throws there. The constructor is for the development server, which has none.
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
      return;
    }
  } catch {
    // fall through to the constructor
  }
  try {
    new Notification(title, options);
  } catch {
    // No way to notify; the vibration and the message in the app remain.
  }
}

/**
 * "Tell me when it's close": watches one bus approaching one stop and alerts once,
 * when it is `alert.minutes` away, then clears itself.
 *
 * The alert keeps its stop polled whether or not that stop is open, so the user
 * can look at other stops or the map while they wait. When the stop is open, its
 * own poll is used (`openStopCode`/`openArrivals`) rather than a second one.
 * There is no push server, so it works while the app is running: on screen, or in
 * the background for as long as the phone lets it run.
 */
export function useArrivalAlert({ alert, setAlert, city, lang, openStopCode, openArrivals, say, t }) {
  const onOpenStop = !!alert && alert.stop.code === openStopCode;
  const background = useLiveArrivals(city, lang, alert && !onOpenStop ? alert.stop.code : null, {
    whileHidden: true,
  });
  const data = onOpenStop ? openArrivals : background.data;
  const vehicle = alert ? data?.vehicles.find((v) => v.vehicleCode === alert.vehicleCode) : null;
  const missing = useRef(0);

  useEffect(() => {
    missing.current = 0;
  }, [alert]);

  useEffect(() => {
    if (!alert || !data) return;
    if (!vehicle) {
      missing.current += 1;
      if (missing.current >= LOST_AFTER_POLLS) {
        setAlert(null);
        say(t('alertLost', { line: alert.lineCode }));
      }
      return;
    }
    missing.current = 0;
    if (vehicle.departureMins > alert.minutes) return;

    setAlert(null);
    const title = t('alertTitle', { line: alert.lineCode });
    const body =
      vehicle.departureMins <= 0
        ? t('alertBodyNow', { stop: alert.stop.name })
        : t('alertBody', { stop: alert.stop.name, n: vehicle.departureMins });
    navigator.vibrate?.(VIBRATION);
    showNotification(title, body);
    say(`${title}: ${body}`, 'alert');
    // Deliberately keyed on the data alone: each answer is looked at once.
  }, [data]);

  // Called from the bell's tap: the permission prompt needs that tap to be allowed.
  const toggle = useCallback(
    (stop, bus, lead) => {
      if (alert?.vehicleCode === bus.vehicleCode && alert.stop.code === stop.code) {
        setAlert(null);
        return;
      }
      // A bus already inside the lead time is announced as it arrives instead.
      const minutes = bus.departureMins > lead ? lead : 1;
      // Not the mark of a stop opened from a link: reopened from the alert bar, it
      // is opened by a tap, and needs a history entry like any other (App.jsx).
      const { fromLink, ...plainStop } = stop;
      setAlert({ stop: plainStop, vehicleCode: bus.vehicleCode, lineCode: bus.lineCode, minutes });
      const announce = (permission) =>
        say(t(permission === 'granted' ? 'alertArmed' : 'alertArmedInApp', { line: bus.lineCode, n: minutes }));
      if (!('Notification' in window)) announce('unsupported');
      else if (Notification.permission !== 'default') announce(Notification.permission);
      else Notification.requestPermission().then(announce, () => announce('default'));
    },
    [alert, setAlert, say, t],
  );

  return { vehicle, onOpenStop, toggle };
}

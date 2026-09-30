import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import StopMap from './components/StopMap.jsx';
import StopSheet from './components/StopSheet.jsx';
import HomePanel from './components/HomePanel.jsx';
import SettingsSheet from './components/SettingsSheet.jsx';
import Icon from './components/Icon.jsx';

import { fetchCities, fetchConfig } from './api.js';
import { useStops } from './hooks/useStops.js';
import { useLiveArrivals } from './hooks/useLiveArrivals.js';
import { useSchedule, useTimetableShown } from './hooks/useSchedule.js';
import { useRouteShape } from './hooks/useRouteShape.js';
import { useRouteSequence } from './hooks/useRouteSequence.js';
import { useGeolocation } from './hooks/useGeolocation.js';
import { useFavourites } from './hooks/useFavourites.js';
import { usePersistentState } from './hooks/usePersistentState.js';
import { useSheetCollapse, useSheetDrag } from './hooks/useSheetDrag.js';
import { useBackButton } from './hooks/useBackButton.js';
import { asAlertLead, DEFAULT_ALERT_LEAD, useArrivalAlert } from './hooks/useArrivalAlert.js';
import { routeProgress } from './geo.js';
import { stopLinkUrl, takeStopLink } from './link.js';
import { asCity, asLang } from './validate.js';
import { cityName, errorMessage, translator } from './i18n.js';

// A shared stop link (/?city=…&stop=…), read before the first render so the app
// opens on that stop rather than flashing the home panel first.
const LINK = takeStopLink();

/**
 * Copies text: the Clipboard API first, then a selected textarea and the old
 * copy command, which works in some embedded browsers that refuse the API.
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // refused, or no Clipboard API (an insecure context, an in-app browser)
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    // not supported
  }
  area.remove();
  return copied;
}

/** A stop link to copy by hand: selected on focus, with a Copy button that tries again. */
function SharePanel({ url, onCopy, onClose, t }) {
  const input = useRef(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [url]);
  return (
    <div className="share-panel">
      <input
        ref={input}
        className="share-url"
        readOnly
        value={url}
        onFocus={(e) => e.target.select()}
        aria-label={t('stopLink')}
      />
      <button type="button" className="btn" onClick={() => onCopy(input.current)}>
        {t('copy')}
      </button>
      <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')} title={t('close')}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

// Stops opened one from another, so back can return through them. Older ones are
// dropped past this: back is also how an installed app is left, and a dozen
// presses to get out is worse than losing a stop from five ago.
const MAX_STOP_TRAIL = 5;

export default function App() {
  // null means "not chosen yet" — the server's configured default fills in.
  const [savedCity, setSavedCity] = usePersistentState('citybus.city.v1', null, asCity);
  // A link's city is shown at once, and saved as if picked in settings once its
  // stops load: a stop shared from a city is almost always for someone in it. Saved
  // at once, a misspelt link replaced the user's city with one that does not exist.
  const [linkCity, setLinkCity] = useState(LINK?.city ?? null);
  const chooseCity = useCallback(
    (next) => {
      setLinkCity(null);
      setSavedCity(next);
    },
    [setSavedCity],
  );
  const [savedLang, setSavedLang] = usePersistentState('citybus.lang.v1', null, asLang);
  const [savedAlertLead, setAlertLead] = usePersistentState('citybus.alertLead.v1', null, asAlertLead);
  const alertLead = savedAlertLead ?? DEFAULT_ALERT_LEAD;

  const [config, setConfig] = useState(null);
  const [cities, setCities] = useState([]);
  // The last stop is the open one. A linked stop starts with only its code; the
  // rest arrives with the stop list.
  const [stopTrail, setStopTrail] = useState(() =>
    LINK ? [{ code: LINK.stop, name: '', fromLink: true }] : [],
  );
  const selectedStop = stopTrail.at(-1) ?? null;
  const [panTarget, setPanTarget] = useState(null);
  const [sheet, setSheet] = useState(LINK ? 'stop' : 'home'); // 'home' | 'stop' | 'settings'
  // The bus whose route is drawn: { vehicleCode, lineCode, routeCode, color }.
  const [focus, setFocus] = useState(null);
  // One arrival alert at a time: { stop, vehicleCode, lineCode, minutes }.
  const [alert, setAlert] = useState(null);
  // A short message over the map: { text, kind: 'info' | 'alert', id }.
  const [toast, setToast] = useState(null);
  const say = useCallback((text, kind = 'info') => setToast({ text, kind, id: Date.now() }), []);
  // A stop link to copy by hand, when neither a share sheet nor the clipboard works.
  const [shareLink, setShareLink] = useState(null);

  const sheetRef = useRef(null);
  const [collapsed, setCollapsed] = useSheetCollapse(sheetRef);
  const panToNextFix = useRef(false);

  const city = linkCity ?? savedCity ?? config?.defaultCity ?? 'irakleio';
  const lang = savedLang ?? config?.defaultLang ?? 'el';
  const t = useMemo(() => translator(lang), [lang]);

  useEffect(() => {
    const controller = new AbortController();
    fetchConfig(controller.signal).then(setConfig).catch(() => {});
    fetchCities(controller.signal).then(setCities).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const { stops, loading: stopsLoading, error: stopsError, retry: retryStops } = useStops(city, lang);
  const favourites = useFavourites();
  const geo = useGeolocation();

  const alertOnOpenStop = !!alert && alert.stop.code === selectedStop?.code;
  const {
    data: arrivals,
    loading: arrivalsLoading,
    error: arrivalsError,
    receivedAt: arrivalsReceivedAt,
    refreshing,
    refresh,
  } = useLiveArrivals(city, lang, selectedStop?.code, { whileHidden: alertOnOpenStop });
  const arrivalAlert = useArrivalAlert({
    alert,
    setAlert,
    city,
    lang,
    openStopCode: selectedStop?.code,
    openArrivals: arrivals,
    say,
    t,
  });

  // Live data only reaches 30 minutes ahead, so the timetable answers what it
  // cannot: always when no bus is due, and on request (or at a quiet stop) otherwise.
  // Live data that failed before any arrived counts as no buses: the timetable may
  // still load, and it is then the only answer on screen.
  const [timetableShown, toggleTimetable] = useTimetableShown(
    selectedStop ? `${city}:${selectedStop.code}` : null,
    arrivals ? arrivals.vehicles.length : arrivalsError ? 0 : null,
  );
  const schedule = useSchedule(city, lang, selectedStop?.code, timetableShown);
  const routePoints = useRouteShape(city, focus?.lineCode, focus?.routeCode);
  const routeStops = useRouteSequence(city, focus?.routeCode);

  // How far along its route the followed bus is: which stops it has left, and how
  // many it calls at before this one.
  const stopsByCode = useMemo(() => new Map(stops.map((s) => [s.code, s])), [stops]);
  const focusedBus = focus ? arrivals?.vehicles.find((v) => v.vehicleCode === focus.vehicleCode) : null;

  // A followed bus leaves the list once it has passed the stop. Its route stayed
  // drawn, with nothing saying it had gone. Two answers without it, not one: the
  // feed drops a bus for a single answer now and then.
  const focusMissing = useRef({ code: null, count: 0, minutes: null });
  useEffect(() => {
    if (!focus || !arrivals) return;
    const seen = focusMissing.current.code === focus.vehicleCode ? focusMissing.current : null;
    if (focusedBus) {
      focusMissing.current = { code: focus.vehicleCode, count: 0, minutes: focusedBus.departureMins };
      return;
    }
    const count = (seen?.count ?? 0) + 1;
    focusMissing.current = { code: focus.vehicleCode, count, minutes: seen?.minutes ?? null };
    if (count < 2) return;
    // The focus is a layer, and useBackButton pops its history entry when the
    // layer count drops. The map and the sheet stay as they are.
    setFocus(null);
    const passed = seen?.minutes != null && seen.minutes <= 1;
    say(t(passed ? 'busPassed' : 'busGone', { line: focus.lineCode }));
    // Keyed on the answers alone, like the alert: each one is counted once.
  }, [arrivals]);
  const progress = useMemo(
    () => routeProgress(routeStops, stopsByCode, focusedBus, selectedStop?.code),
    [routeStops, stopsByCode, focusedBus, selectedStop?.code],
  );

  const refreshStop = useCallback(() => {
    refresh();
    schedule.refresh();
  }, [refresh, schedule.refresh]);

  const openSheet = useCallback(
    (name) => {
      setSheet(name);
      setCollapsed(false);
    },
    [setCollapsed],
  );

  const { gripProps, onHandleClick } = useSheetDrag(sheetRef, collapsed, setCollapsed);

  // The link's city is adopted once its stops load, or dropped if it has none: a
  // typo, or a city without data. Dropping it returns to the saved city.
  useEffect(() => {
    if (!linkCity || linkCity !== city) return;
    if (stops.length) {
      chooseCity(linkCity);
    } else if (stopsError?.status === 404) {
      setLinkCity(null);
      say(t('linkCityUnavailable'));
    }
  }, [linkCity, city, stops, stopsError, chooseCity, say, t]);

  // A stop from one city is meaningless in another. Only on a change: on the first
  // render it would close a stop opened from a link.
  const shownCity = useRef(city);
  useEffect(() => {
    if (shownCity.current === city) return;
    shownCity.current = city;
    setStopTrail([]);
    setFocus(null);
    setAlert(null);
    openSheet('home');
  }, [city, openSheet]);

  // A message's time on screen starts only while the app is in view. An alert
  // that fired in the background, with notifications refused, left nothing to see
  // on return: its message had timed out unseen.
  useEffect(() => {
    if (!toast) return undefined;
    let timer = null;
    const start = () => {
      if (document.hidden || timer) return;
      timer = setTimeout(() => setToast(null), toast.kind === 'alert' ? 10_000 : 4_000);
    };
    start();
    document.addEventListener('visibilitychange', start);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', start);
    };
  }, [toast]);

  const panToStop = useCallback((stop) => {
    if (Number.isFinite(stop?.latitude) && Number.isFinite(stop?.longitude)) {
      setPanTarget({ lat: stop.latitude, lon: stop.longitude, at: Date.now() });
    }
  }, []);

  // A stop opened from another one stacks on it (reported: back from a stop picked
  // on the map went home, not to the stop before). One already in the trail moves
  // to the top rather than appearing twice.
  const selectStop = useCallback(
    (stop) => {
      setStopTrail((trail) =>
        [...trail.filter((s) => s.code !== stop.code), stop].slice(-MAX_STOP_TRAIL),
      );
      setFocus(null);
      openSheet('stop');
      panToStop(stop);
    },
    [openSheet, panToStop],
  );

  // The close button leaves every stop, not just the top one.
  const closeStop = useCallback(() => {
    setStopTrail([]);
    setFocus(null);
    openSheet('home');
  }, [openSheet]);

  // Keep the open stop's details in sync when the language switches, and fill in a
  // linked stop once the stop list arrives. Older stops in the trail catch up when
  // back returns to them.
  useEffect(() => {
    if (!selectedStop) return;
    const fresh = stops.find((s) => s.code === selectedStop.code);
    if (!fresh) {
      // A link to a stop its city does not have: a typo, or a stop since retired.
      if (selectedStop.fromLink && stops.length) closeStop();
      return;
    }
    if (fresh.name !== selectedStop.name) {
      setStopTrail((trail) => [
        ...trail.slice(0, -1),
        selectedStop.fromLink ? { ...fresh, fromLink: true } : fresh,
      ]);
      if (!Number.isFinite(selectedStop.latitude)) panToStop(fresh);
    }
  }, [stops, selectedStop, closeStop, panToStop]);

  // Back from a stop: the one before it, or home when there is none.
  const returnToStops = useCallback(
    (count) => {
      if (count <= 0) {
        closeStop();
        return;
      }
      setStopTrail((trail) => trail.slice(0, count));
      setFocus(null);
      openSheet('stop');
      panToStop(stopTrail[count - 1]);
    },
    [closeStop, openSheet, panToStop, stopTrail],
  );

  // Show one bus: draw its route, get the sheet out of the way, and frame the bus
  // together with the stop, so the user sees how far away it actually is.
  const focusVehicle = useCallback(
    (vehicle) => {
      setFocus({
        vehicleCode: vehicle.vehicleCode,
        lineCode: vehicle.lineCode,
        routeCode: vehicle.routeCode,
        color: vehicle.lineColor || '#1d4ed8',
      });
      setCollapsed(true);
      if (!vehicle.hasPosition) return;
      const bounds = [[vehicle.latitude, vehicle.longitude]];
      if (Number.isFinite(selectedStop?.latitude)) {
        bounds.push([selectedStop.latitude, selectedStop.longitude]);
      }
      setPanTarget({ bounds, at: Date.now() });
    },
    [selectedStop, setCollapsed],
  );

  // Undoes focusVehicle: the full list again, and the stop back in view.
  const unfocusVehicle = useCallback(() => {
    setFocus(null);
    setCollapsed(false);
    if (Number.isFinite(selectedStop?.latitude) && Number.isFinite(selectedStop?.longitude)) {
      setPanTarget({ lat: selectedStop.latitude, lon: selectedStop.longitude, at: Date.now() });
    }
  }, [selectedStop, setCollapsed]);

  // What the back button closes, topmost first, before it is allowed to leave the
  // app: settings, a followed bus, then each stop in the trail. A stop opened from
  // a link is not a layer: no tap opened it, so it has no history entry (Chrome
  // skips entries pushed without one; see useBackButton), and back from it leaves,
  // as back from any linked page does.
  const linkBase = stopTrail[0]?.fromLink ? 1 : 0;
  const layers =
    stopTrail.length - linkBase + (focus ? 1 : 0) + (sheet === 'settings' ? 1 : 0);
  const closeLayersTo = useCallback(
    (keep) => {
      let open = layers;
      if (open > keep && sheet === 'settings') {
        openSheet(selectedStop ? 'stop' : 'home');
        open -= 1;
      }
      if (open > keep && focus) {
        unfocusVehicle();
        open -= 1;
      }
      if (open > keep && stopTrail.length) returnToStops(stopTrail.length - (open - keep));
    },
    [layers, sheet, selectedStop, focus, stopTrail, openSheet, unfocusVehicle, returnToStops],
  );
  useBackButton(layers, closeLayersTo);

  // Dragging the map means the user wants to look at it; the settings sheet is
  // the exception, since it is modal in spirit.
  const onMapDrag = useCallback(() => {
    if (sheet !== 'settings') setCollapsed(true);
  }, [sheet, setCollapsed]);

  // An open stop grows as its arrivals load, after any pan has already been
  // planned against the short loading state — which left the stop just above the
  // sheet and then under it. So while a stop is expanded, plan for the height the
  // sheet can reach. Read from the DOM, which is committed before the map's
  // effects run, so this stays stable and never re-triggers a pan by itself.
  // Mid-collapse the height is animating, so use the one it is heading for.
  const getBottomInset = useCallback(() => {
    const el = sheetRef.current;
    if (!el) return undefined;
    const height = Number(el.dataset.restHeight) || el.offsetHeight;
    if (el.dataset.mode !== 'stop' || el.classList.contains('collapsed')) return height;
    return Math.max(height, parseFloat(getComputedStyle(el).maxHeight) || 0);
  }, []);

  // The position is watched continuously, so the map must not follow every fix —
  // it pans once per explicit request, or the user could never look elsewhere.
  const requestLocation = useCallback(() => {
    if (geo.position) {
      setPanTarget({ lat: geo.position.lat, lon: geo.position.lon, zoom: 16, at: Date.now() });
    } else {
      panToNextFix.current = true;
    }
    geo.request();
  }, [geo]);

  useEffect(() => {
    if (geo.position && panToNextFix.current) {
      panToNextFix.current = false;
      setPanTarget({ lat: geo.position.lat, lon: geo.position.lon, zoom: 16, at: Date.now() });
    }
  }, [geo.position]);

  // The system share sheet where there is one (phones), else the clipboard, else
  // the link in a panel to copy by hand. It used to be shown in a message that went
  // after 4 seconds and closed when tapped, which is how one tries to select it.
  const shareStop = useCallback(async () => {
    if (!selectedStop) return;
    const url = stopLinkUrl(city, selectedStop.code);
    if (navigator.share) {
      try {
        await navigator.share({ title: selectedStop.name || `${t('stop')} ${selectedStop.code}`, url });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // the user closed the share sheet
      }
    }
    if (await copyText(url)) say(t('linkCopied'));
    else setShareLink(url);
  }, [city, selectedStop, say, t]);

  const copyShareLink = useCallback(
    async (input) => {
      if (await copyText(shareLink)) {
        setShareLink(null);
        say(t('linkCopied'));
      } else {
        input?.select(); // left selected, for the system's own copy
      }
    },
    [shareLink, say, t],
  );

  useEffect(() => {
    setShareLink(null);
  }, [selectedStop?.code]);

  const toggleSettings = () =>
    sheet === 'settings' ? openSheet(selectedStop ? 'stop' : 'home') : openSheet('settings');

  const cityLabel = cityName(cities.find((c) => c.slug === city) ?? { slug: city }, lang);
  const isFavourite = selectedStop ? favourites.isFavourite(city, selectedStop.code) : false;

  return (
    <div className="app">
      <StopMap
        stops={stops}
        cityKey={city}
        selectedStop={selectedStop}
        onSelectStop={selectStop}
        vehicles={arrivals?.vehicles ?? []}
        focusedVehicle={focus?.vehicleCode}
        onSelectVehicle={focusVehicle}
        routePoints={routePoints}
        routeCode={focus?.routeCode}
        routeColor={focus?.color}
        routeStops={routeStops}
        passedIndex={progress?.passed}
        userPosition={geo.position}
        panTarget={panTarget}
        getBottomInset={getBottomInset}
        onUserDrag={onMapDrag}
        t={t}
      />

      <header className="topbar">
        <button
          type="button"
          className="city-btn"
          onClick={toggleSettings}
          aria-label={`${t('changeCity')}: ${cityLabel}`}
          aria-expanded={sheet === 'settings'}
          title={t('changeCity')}
        >
          <Icon name="pin" size={16} />
          <span className="city-name">{cityLabel}</span>
          <Icon name="chevronDown" size={16} />
        </button>
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn round"
            onClick={toggleSettings}
            aria-label={t('settings')}
            title={t('settings')}
          >
            <Icon name="settings" />
          </button>
          <button
            type="button"
            className={`icon-btn round ${geo.status === 'ready' ? 'on' : ''}`}
            onClick={requestLocation}
            aria-label={t('locate')}
            title={t('locate')}
          >
            <Icon name="locate" />
          </button>
        </div>
      </header>

      <section
        ref={sheetRef}
        className={`sheet ${collapsed ? 'collapsed' : ''}`}
        data-mode={sheet}
      >
        <button
          type="button"
          className="sheet-handle"
          aria-label={collapsed ? t('expandSheet') : t('collapseSheet')}
          aria-expanded={!collapsed}
          onClick={onHandleClick}
          {...gripProps}
        />

        {/* An alert set on another stop stays in sight, and a tap returns to it. */}
        {alert && sheet !== 'settings' && !(sheet === 'stop' && alertOnOpenStop) && (
          <div className="alert-bar">
            <button type="button" className="alert-bar-main" onClick={() => selectStop(alert.stop)}>
              <Icon name="bell" size={15} filled />
              <span className="alert-bar-text">
                <strong>{alert.lineCode}</strong> · {alert.stop.name}
              </span>
              {arrivalAlert.vehicle && (
                <span className="alert-bar-eta">
                  {arrivalAlert.vehicle.departureMins}
                  {t('minShort')}
                </span>
              )}
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setAlert(null)}
              aria-label={t('alertOff')}
              title={t('alertOff')}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}

        {sheet === 'settings' && (
          <SettingsSheet
            cities={cities}
            city={city}
            onCityChange={(next) => {
              chooseCity(next);
              openSheet('home');
            }}
            lang={lang}
            onLangChange={setSavedLang}
            alertLead={alertLead}
            onAlertLeadChange={setAlertLead}
            onClose={() => openSheet(selectedStop ? 'stop' : 'home')}
            collapsed={collapsed}
            gripProps={gripProps}
            t={t}
          />
        )}

        {sheet === 'stop' && selectedStop && (
          <StopSheet
            stop={selectedStop}
            arrivals={arrivals}
            schedule={schedule}
            timetableShown={timetableShown}
            onToggleTimetable={toggleTimetable}
            loading={arrivalsLoading}
            error={arrivalsError}
            receivedAt={arrivalsReceivedAt}
            refreshing={refreshing}
            onRefresh={refreshStop}
            onClose={closeStop}
            isFavourite={isFavourite}
            onToggleFavourite={() => favourites.toggle(city, selectedStop)}
            focusedVehicle={focus?.vehicleCode}
            stopsBefore={progress?.stopsBefore}
            onFocusVehicle={focusVehicle}
            onUnfocus={unfocusVehicle}
            alert={alertOnOpenStop ? alert : null}
            alertLead={alertLead}
            onToggleAlert={(vehicle) => arrivalAlert.toggle(selectedStop, vehicle, alertLead)}
            onShare={shareStop}
            collapsed={collapsed}
            gripProps={gripProps}
            lang={lang}
            t={t}
          />
        )}

        {sheet === 'home' && (
          <>
            {stopsLoading && !stopsError && <p className="state">{t('loadingStops')}</p>}
            {stopsError && (
              <div className="state error" role="status">
                {/* A few citybus.gr cities have a site but no data in the API. That
                    will not change on a retry; anything else might. */}
                {stopsError.status === 404 ? (
                  <p>{t('cityUnavailable')}</p>
                ) : (
                  <>
                    <p>{errorMessage(stopsError, t)}</p>
                    <button type="button" className="btn" onClick={retryStops} disabled={stopsLoading}>
                      {stopsLoading ? t('loading') : t('retry')}
                    </button>
                  </>
                )}
              </div>
            )}
            {/* During a retry the failure stays, and so do the favourites. */}
            {(!stopsLoading || stopsError) && (
              <HomePanel
                stops={stops}
                stopsUnavailable={!!stopsError}
                favourites={favourites.forCity(city)}
                onSelectStop={selectStop}
                geo={geo}
                onRequestLocation={requestLocation}
                cities={cities}
                city={city}
                onSwitchCity={chooseCity}
                collapsed={collapsed}
                onExpand={() => setCollapsed(false)}
                lang={lang}
                t={t}
              />
            )}
          </>
        )}
      </section>

      {/* Always in the page, so screen readers announce what appears in it. */}
      <div className="toast-region" aria-live="polite">
        {shareLink && (
          <SharePanel
            url={shareLink}
            onCopy={copyShareLink}
            onClose={() => setShareLink(null)}
            t={t}
          />
        )}
        {toast && (
          <button
            key={toast.id}
            type="button"
            className={`toast ${toast.kind}`}
            role={toast.kind === 'alert' ? 'alert' : undefined}
            onClick={() => setToast(null)}
          >
            {toast.text}
          </button>
        )}
      </div>
    </div>
  );
}

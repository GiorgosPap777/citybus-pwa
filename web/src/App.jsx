import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import StopMap from './components/StopMap.jsx';
import StopSheet from './components/StopSheet.jsx';
import HomePanel from './components/HomePanel.jsx';
import SettingsSheet from './components/SettingsSheet.jsx';
import Icon from './components/Icon.jsx';

import { fetchCities, fetchConfig } from './api.js';
import { useStops } from './hooks/useStops.js';
import { useLiveArrivals } from './hooks/useLiveArrivals.js';
import { useSchedule } from './hooks/useSchedule.js';
import { useRouteShape } from './hooks/useRouteShape.js';
import { useGeolocation } from './hooks/useGeolocation.js';
import { useFavourites } from './hooks/useFavourites.js';
import { usePersistentState } from './hooks/usePersistentState.js';
import { useSheetDrag } from './hooks/useSheetDrag.js';
import { cityName, translator } from './i18n.js';

export default function App() {
  // null means "not chosen yet" — the server's configured default fills in.
  const [savedCity, setSavedCity] = usePersistentState('citybus.city.v1', null);
  const [savedLang, setSavedLang] = usePersistentState('citybus.lang.v1', null);

  const [config, setConfig] = useState(null);
  const [cities, setCities] = useState([]);
  const [selectedStop, setSelectedStop] = useState(null);
  const [panTarget, setPanTarget] = useState(null);
  const [sheet, setSheet] = useState('home'); // 'home' | 'stop' | 'settings'
  const [collapsed, setCollapsed] = useState(false);
  // The bus whose route is drawn: { vehicleCode, lineCode, routeCode, color }.
  const [focus, setFocus] = useState(null);

  const sheetRef = useRef(null);
  const panToNextFix = useRef(false);

  const city = savedCity ?? config?.defaultCity ?? 'irakleio';
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

  const { stops, loading: stopsLoading, error: stopsError } = useStops(city, lang);
  const favourites = useFavourites();
  const geo = useGeolocation();

  const {
    data: arrivals,
    loading: arrivalsLoading,
    error: arrivalsError,
    refreshing,
    refresh,
  } = useLiveArrivals(city, lang, selectedStop?.code);

  // Live data only reaches 30 minutes ahead; when it is empty, the timetable is
  // the only way to say when the next bus is.
  const schedule = useSchedule(city, lang, selectedStop?.code, arrivals?.vehicles.length === 0);
  const routePoints = useRouteShape(city, focus?.lineCode, focus?.routeCode);

  const openSheet = useCallback((name) => {
    setSheet(name);
    setCollapsed(false);
  }, []);

  const { gripProps, onHandleClick } = useSheetDrag(sheetRef, collapsed, setCollapsed);

  // A stop from one city is meaningless in another.
  useEffect(() => {
    setSelectedStop(null);
    setFocus(null);
    openSheet('home');
  }, [city, openSheet]);

  // Keep the selected stop's details in sync when the language switches.
  useEffect(() => {
    if (!selectedStop) return;
    const fresh = stops.find((s) => s.code === selectedStop.code);
    if (fresh && fresh.name !== selectedStop.name) setSelectedStop(fresh);
  }, [stops, selectedStop]);

  const selectStop = useCallback(
    (stop) => {
      setSelectedStop(stop);
      setFocus(null);
      openSheet('stop');
      if (Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude)) {
        setPanTarget({ lat: stop.latitude, lon: stop.longitude, at: Date.now() });
      }
    },
    [openSheet],
  );

  const closeStop = useCallback(() => {
    setSelectedStop(null);
    setFocus(null);
    openSheet('home');
  }, [openSheet]);

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
    [selectedStop],
  );

  // Dragging the map means the user wants to look at it; the settings sheet is
  // the exception, since it is modal in spirit.
  const onMapDrag = useCallback(() => {
    if (sheet !== 'settings') setCollapsed(true);
  }, [sheet]);

  // An open stop grows as its arrivals load, after any pan has already been
  // planned against the short loading state — which left the stop just above the
  // sheet and then under it. So while a stop is expanded, plan for the height the
  // sheet can reach. Read from the DOM, which is committed before the map's
  // effects run, so this stays stable and never re-triggers a pan by itself.
  const getBottomInset = useCallback(() => {
    const el = sheetRef.current;
    if (!el) return undefined;
    if (el.dataset.mode !== 'stop' || el.classList.contains('collapsed')) return el.offsetHeight;
    return Math.max(el.offsetHeight, parseFloat(getComputedStyle(el).maxHeight) || 0);
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
        routeColor={focus?.color}
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
        aria-live="polite"
      >
        <button
          type="button"
          className="sheet-handle"
          aria-label={collapsed ? t('expandSheet') : t('collapseSheet')}
          aria-expanded={!collapsed}
          onClick={onHandleClick}
          {...gripProps}
        />

        {sheet === 'settings' && (
          <SettingsSheet
            cities={cities}
            city={city}
            onCityChange={(next) => {
              setSavedCity(next);
              openSheet('home');
            }}
            lang={lang}
            onLangChange={setSavedLang}
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
            loading={arrivalsLoading}
            error={arrivalsError}
            refreshing={refreshing}
            onRefresh={refresh}
            onClose={closeStop}
            isFavourite={isFavourite}
            onToggleFavourite={() => favourites.toggle(city, selectedStop)}
            focusedVehicle={focus?.vehicleCode}
            onFocusVehicle={focusVehicle}
            collapsed={collapsed}
            gripProps={gripProps}
            t={t}
          />
        )}

        {sheet === 'home' && (
          <>
            {stopsLoading && <p className="state">{t('loadingStops')}</p>}
            {stopsError && (
              <p className="state error">
                {/* A few citybus.gr cities have a site but no data in the API. */}
                {stopsError.status === 404 ? t('cityUnavailable') : stopsError.message || t('error')}
              </p>
            )}
            {!stopsLoading && !stopsError && (
              <HomePanel
                stops={stops}
                favourites={favourites.forCity(city)}
                onSelectStop={selectStop}
                geo={geo}
                onRequestLocation={requestLocation}
                collapsed={collapsed}
                onExpand={() => setCollapsed(false)}
                t={t}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

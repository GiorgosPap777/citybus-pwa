import { useCallback, useEffect, useMemo, useState } from 'react';

import StopMap from './components/StopMap.jsx';
import StopSheet from './components/StopSheet.jsx';
import HomePanel from './components/HomePanel.jsx';
import SettingsSheet from './components/SettingsSheet.jsx';

import { fetchCities, fetchConfig } from './api.js';
import { useStops } from './hooks/useStops.js';
import { useLiveArrivals } from './hooks/useLiveArrivals.js';
import { useGeolocation } from './hooks/useGeolocation.js';
import { useFavourites } from './hooks/useFavourites.js';
import { usePersistentState } from './hooks/usePersistentState.js';
import { translator } from './i18n.js';

export default function App() {
  // null means "not chosen yet" — the server's configured default fills in.
  const [savedCity, setSavedCity] = usePersistentState('citybus.city.v1', null);
  const [savedLang, setSavedLang] = usePersistentState('citybus.lang.v1', null);

  const [config, setConfig] = useState(null);
  const [cities, setCities] = useState([]);
  const [selectedStop, setSelectedStop] = useState(null);
  const [panTarget, setPanTarget] = useState(null);
  const [sheet, setSheet] = useState('home'); // 'home' | 'stop' | 'settings'

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

  // A stop from one city is meaningless in another.
  useEffect(() => {
    setSelectedStop(null);
    setSheet('home');
  }, [city]);

  // Keep the selected stop's details in sync when the language switches.
  useEffect(() => {
    if (!selectedStop) return;
    const fresh = stops.find((s) => s.code === selectedStop.code);
    if (fresh && fresh.name !== selectedStop.name) setSelectedStop(fresh);
  }, [stops, selectedStop]);

  const selectStop = useCallback((stop) => {
    setSelectedStop(stop);
    setSheet('stop');
    if (Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude)) {
      setPanTarget({ lat: stop.latitude, lon: stop.longitude, at: Date.now() });
    }
  }, []);

  const closeStop = useCallback(() => {
    setSelectedStop(null);
    setSheet('home');
  }, []);

  const locateVehicle = useCallback((vehicle) => {
    setPanTarget({ lat: vehicle.latitude, lon: vehicle.longitude, zoom: 17, at: Date.now() });
  }, []);

  const requestLocation = useCallback(() => geo.request(), [geo]);

  // Once a fix arrives, show the user where they are.
  useEffect(() => {
    if (geo.position) {
      setPanTarget({ lat: geo.position.lat, lon: geo.position.lon, zoom: 16, at: Date.now() });
    }
  }, [geo.position]);

  const cityName = cities.find((c) => c.slug === city)?.name ?? city;
  const isFavourite = selectedStop ? favourites.isFavourite(city, selectedStop.code) : false;

  return (
    <div className="app">
      <StopMap
        stops={stops}
        cityKey={city}
        selectedStop={selectedStop}
        onSelectStop={selectStop}
        vehicles={arrivals?.vehicles ?? []}
        userPosition={geo.position}
        panTarget={panTarget}
        t={t}
      />

      <header className="topbar">
        <button type="button" className="city-btn" onClick={() => setSheet('settings')}>
          <span className="pin" aria-hidden="true">◈</span>
          {cityName}
        </button>
        <button
          type="button"
          className="icon-btn round"
          onClick={requestLocation}
          aria-label={t('locate')}
          title={t('locate')}
        >
          ➤
        </button>
      </header>

      <section className="sheet" aria-live="polite">
        {sheet === 'settings' && (
          <SettingsSheet
            cities={cities}
            city={city}
            onCityChange={(next) => {
              setSavedCity(next);
              setSheet('home');
            }}
            lang={lang}
            onLangChange={setSavedLang}
            onClose={() => setSheet(selectedStop ? 'stop' : 'home')}
            t={t}
          />
        )}

        {sheet === 'stop' && selectedStop && (
          <StopSheet
            stop={selectedStop}
            arrivals={arrivals}
            loading={arrivalsLoading}
            error={arrivalsError}
            refreshing={refreshing}
            onRefresh={refresh}
            onClose={closeStop}
            isFavourite={isFavourite}
            onToggleFavourite={() => favourites.toggle(city, selectedStop)}
            onLocateVehicle={locateVehicle}
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
                t={t}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { formatDistance, nearestStops } from '../geo.js';

function StopRow({ stop, onSelect, trailing }) {
  return (
    <li>
      <button type="button" className="stop-row" onClick={() => onSelect(stop)}>
        <span className="stop-code">{stop.code}</span>
        <span className="stop-name">{stop.name}</span>
        {trailing && <span className="stop-meta">{trailing}</span>}
      </button>
    </li>
  );
}

export default function HomePanel({
  stops,
  favourites,
  onSelectStop,
  geo,
  onRequestLocation,
  t,
}) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return null;
    return stops
      .filter(
        (s) =>
          s.code.toLocaleLowerCase().includes(needle) ||
          s.name.toLocaleLowerCase().includes(needle),
      )
      .slice(0, 25);
  }, [query, stops]);

  const favouriteStops = useMemo(() => {
    const byCode = new Map(stops.map((s) => [s.code, s]));
    // Fall back to the saved name so a favourite still renders while stops load,
    // or if a stop is retired upstream.
    return favourites.map((f) => byCode.get(f.code) ?? { code: f.code, name: f.name });
  }, [favourites, stops]);

  const nearby = useMemo(
    () => (geo.position && stops.length ? nearestStops(stops, geo.position, 6) : []),
    [geo.position, stops],
  );

  const locationMessage = {
    denied: t('locationDenied'),
    insecure: t('locationInsecure'),
    unavailable: t('locationUnavailable'),
  }[geo.error];

  return (
    <>
      <div className="search-row">
        <input
          type="search"
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchStops')}
          aria-label={t('searchStops')}
        />
      </div>

      {results !== null ? (
        results.length ? (
          <ul className="stop-list">
            {results.map((stop) => (
              <StopRow key={stop.code} stop={stop} onSelect={onSelectStop} />
            ))}
          </ul>
        ) : (
          <p className="state">{t('noResults')}</p>
        )
      ) : (
        <>
          <section>
            <h3 className="section-head">{t('favourites')}</h3>
            {favouriteStops.length ? (
              <ul className="stop-list">
                {favouriteStops.map((stop) => (
                  <StopRow key={stop.code} stop={stop} onSelect={onSelectStop} />
                ))}
              </ul>
            ) : (
              <p className="hint">{t('noFavourites')}</p>
            )}
          </section>

          <section>
            <h3 className="section-head">
              {t('nearby')}
              {geo.status !== 'ready' && (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={onRequestLocation}
                  disabled={geo.status === 'locating'}
                >
                  {geo.status === 'locating' ? t('locating') : t('locate')}
                </button>
              )}
            </h3>
            {nearby.length ? (
              <ul className="stop-list">
                {nearby.map((stop) => (
                  <StopRow
                    key={stop.code}
                    stop={stop}
                    onSelect={onSelectStop}
                    trailing={formatDistance(stop.distance, t)}
                  />
                ))}
              </ul>
            ) : (
              <p className="hint">{locationMessage || t('enableLocation')}</p>
            )}
          </section>
        </>
      )}
    </>
  );
}

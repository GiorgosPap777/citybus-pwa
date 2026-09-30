import { useMemo, useState } from 'react';
import { formatDistance, nearestStops } from '../geo.js';

/**
 * Greek stop names are mostly capitals without accents ("ΠΑΝΕΠΙΣΤΗΜΙΟ"), but
 * people type lowercase with them ("πανεπιστήμιο"), which lowercasing alone never
 * matches. Strip diacritics and fold final sigma so both sides compare equal.
 * Tolerates a missing name: an installed app can still hold an older cached stop
 * list in which a few English names were null.
 */
const fold = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/\s+/g, ' ');

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
  stopsUnavailable = false,
  favourites,
  onSelectStop,
  geo,
  onRequestLocation,
  collapsed,
  onExpand,
  t,
}) {
  const [query, setQuery] = useState('');

  // Folded once per stop list, not once per keystroke.
  const searchIndex = useMemo(
    () => stops.map((stop) => ({ stop, code: fold(stop.code), name: fold(stop.name) })),
    [stops],
  );

  const results = useMemo(() => {
    const needle = fold(query).trim();
    if (!needle) return null;
    return searchIndex
      .filter((entry) => entry.code.includes(needle) || entry.name.includes(needle))
      .slice(0, 25)
      .map((entry) => entry.stop);
  }, [query, searchIndex]);

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

  // Without the stop list there is nothing to search or sort by distance, but a
  // favourite carries its saved name and code, which is all live arrivals need.
  if (stopsUnavailable) {
    return collapsed || !favouriteStops.length ? null : (
      <section>
        <h3 className="section-head">{t('favourites')}</h3>
        <ul className="stop-list">
          {favouriteStops.map((stop) => (
            <StopRow key={stop.code} stop={stop} onSelect={onSelectStop} />
          ))}
        </ul>
      </section>
    );
  }

  return (
    <>
      <div className="search-row">
        <input
          type="search"
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={onExpand}
          placeholder={t('searchStops')}
          aria-label={t('searchStops')}
        />
      </div>

      {/* Collapsed, the panel keeps only the search box: the one thing worth
          reaching for while looking at the map. */}
      {collapsed ? null : results !== null ? (
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

import { useMemo, useState } from 'react';
import { FAR_FROM_CITY_M, formatDistance, nearestCity, nearestStops } from '../geo.js';
import { cityName } from '../i18n.js';
import { fold, matchesStems, soundOf, soundsOfQuery, stemsOfQuery } from '../search.js';

const MAX_RESULTS = 25;

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
  cities,
  city,
  onSwitchCity,
  collapsed,
  onExpand,
  lang,
  t,
}) {
  const [query, setQuery] = useState('');

  // Folded once per stop list, not once per keystroke.
  const searchIndex = useMemo(
    () =>
      stops.map((stop) => {
        const sound = soundOf(stop.name);
        return { stop, code: fold(stop.code), name: fold(stop.name), sound, words: sound.split(' ') };
      }),
    [stops],
  );

  // Matches as typed come first. Then matches by sound (Greeklish, a misplaced η
  // or ω), then by words in any order with any ending (search.js). Each only fills
  // the list after the ones before, so it never pushes a closer match out.
  const results = useMemo(() => {
    const needle = fold(query).trim();
    if (!needle) return null;
    const matches = searchIndex.filter(
      (entry) => entry.code.includes(needle) || entry.name.includes(needle),
    );
    const found = new Set(matches);
    const fill = (test) => {
      for (const entry of searchIndex) {
        if (matches.length >= MAX_RESULTS) return;
        if (!found.has(entry) && test(entry)) {
          matches.push(entry);
          found.add(entry);
        }
      }
    };
    const sounds = soundsOfQuery(query);
    fill((entry) => sounds.some((sound) => entry.sound.includes(sound)));
    const readings = stemsOfQuery(query);
    fill((entry) => readings.some((stems) => matchesStems(stems, entry.words)));
    return matches.slice(0, MAX_RESULTS).map((entry) => entry.stop);
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

  // Stops tens of kilometres away are no use as "near me": the user is in another
  // city, or none. Offer the city they are in, when it is on the platform.
  const far = nearby.length > 0 && nearby[0].distance > FAR_FROM_CITY_M;
  const suggestion = useMemo(
    () => (far ? nearestCity(cities, geo.position, city) : null),
    [far, cities, geo.position, city],
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
            {far ? (
              <>
                <p className="hint">
                  {t('farFromCity', { distance: formatDistance(nearby[0].distance, t) })}
                </p>
                {suggestion && (
                  <button type="button" className="btn wide" onClick={() => onSwitchCity(suggestion.slug)}>
                    {t('switchCity', { city: cityName(suggestion, lang) })}
                  </button>
                )}
              </>
            ) : nearby.length ? (
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

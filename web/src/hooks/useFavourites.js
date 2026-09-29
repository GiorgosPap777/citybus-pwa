import { useCallback, useMemo } from 'react';
import { usePersistentState } from './usePersistentState.js';

const KEY = 'citybus.favourites.v1';

/**
 * Saved data outlives the code that wrote it. A malformed entry would otherwise
 * crash every launch, and the error screen's reload could never clear it.
 */
const sanitize = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((f) => typeof f?.city === 'string' && typeof f.code === 'string')
    .map((f) => ({ city: f.city, code: f.code, name: typeof f.name === 'string' ? f.name : '' }));

/** Favourites are scoped per city, so switching city shows the right shortlist. */
export function useFavourites() {
  const [stored, setStored] = usePersistentState(KEY, []);
  const items = useMemo(() => sanitize(stored), [stored]);
  const setItems = useCallback((update) => setStored((prev) => update(sanitize(prev))), [setStored]);

  const isFavourite = useCallback(
    (city, code) => items.some((f) => f.city === city && f.code === code),
    [items],
  );

  const toggle = useCallback(
    (city, stop) =>
      setItems((prev) =>
        prev.some((f) => f.city === city && f.code === stop.code)
          ? prev.filter((f) => !(f.city === city && f.code === stop.code))
          : [...prev, { city, code: stop.code, name: stop.name }],
      ),
    [setItems],
  );

  const forCity = useCallback((city) => items.filter((f) => f.city === city), [items]);

  return { items, isFavourite, toggle, forCity };
}

import { useCallback } from 'react';
import { usePersistentState } from './usePersistentState.js';

const KEY = 'citybus.favourites.v1';

/** Favourites are scoped per city, so switching city shows the right shortlist. */
export function useFavourites() {
  const [items, setItems] = usePersistentState(KEY, []);

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

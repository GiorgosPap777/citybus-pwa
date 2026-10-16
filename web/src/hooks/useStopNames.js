import { useCallback, useMemo } from 'react';
import { usePersistentState } from './usePersistentState.js';
import { asCity, asStopCode } from '../validate.js';

const KEY = 'citybus.stopNames.v1';

// Room for the longest official name (50 characters, 2026-10) and a few words
// added to it, such as a direction.
export const MAX_STOP_NAME = 60;

const clean = (name) => (typeof name === 'string' ? name.trim().slice(0, MAX_STOP_NAME) : '');

/**
 * Saved data outlives the code that wrote it, and is read again on every launch
 * (see useFavourites), so anything malformed is dropped on read.
 */
const sanitize = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((n) => asCity(n?.city) && asStopCode(n.code) && clean(n.name))
    .map((n) => ({ city: n.city, code: n.code, name: clean(n.name) }));

/**
 * The user's own names for stops. Many stops share a name (the two sides of a
 * street, ΑΓΙΟΣ ΓΕΩΡΓΙΟΣ in several places), and a favourites list of identical
 * names is no help. A name is the user's, so it is kept whatever the language,
 * and never put in a shared link.
 *
 * `names` maps the city's stop codes to names. It keeps its identity until a name
 * changes: the map's stop markers are memoised on it.
 */
export function useStopNames(city) {
  const [items, setItems] = usePersistentState(KEY, [], sanitize);

  const names = useMemo(
    () => new Map(items.filter((n) => n.city === city).map((n) => [n.code, n.name])),
    [items, city],
  );

  // An empty name, or the official one unchanged, removes the stop's own name.
  const rename = useCallback(
    (code, name, officialName) => {
      const next = clean(name);
      setItems((prev) => [
        ...prev.filter((n) => !(n.city === city && n.code === code)),
        ...(next && next !== officialName ? [{ city, code, name: next }] : []),
      ]);
    },
    [city, setItems],
  );

  return { names, rename };
}

import { useEffect, useState } from 'react';
import { readJson, writeJson } from '../storage.js';

/**
 * State saved to localStorage. `sanitise` vets what is read back: saved data is
 * read again on every launch, so a value the app cannot handle would break every
 * launch, and the error screen's reload with it.
 */
export function usePersistentState(key, initialValue, sanitise = (value) => value) {
  const [value, setValue] = useState(() => sanitise(readJson(key, initialValue)));
  useEffect(() => {
    writeJson(key, value);
  }, [key, value]);
  return [value, setValue];
}

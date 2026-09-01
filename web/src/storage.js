// localStorage throws in some privacy modes, so every access is guarded and
// simply degrades to "no saved preferences" rather than breaking the app.
export function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Out of quota or storage blocked — preferences just will not persist.
  }
}

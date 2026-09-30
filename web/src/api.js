async function getJson(path, signal) {
  const res = await fetch(path, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body; the status message is enough
    }
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

export const fetchConfig = (signal) => getJson('/api/config', signal);
export const fetchCities = (signal) => getJson('/api/cities', signal);

export const fetchStops = (city, lang, signal) =>
  getJson(`/api/${city}/stops?lang=${lang}`, signal);

export const fetchLiveArrivals = (city, lang, stopCode, signal) =>
  getJson(`/api/${city}/stops/${encodeURIComponent(stopCode)}/live?lang=${lang}`, signal);

export const fetchRouteShape = (city, lineCode, routeCode, signal) =>
  getJson(
    `/api/${city}/lines/${encodeURIComponent(lineCode)}/routes/${encodeURIComponent(routeCode)}/shape`,
    signal,
  );

export const fetchSchedule = (city, lang, stopCode, signal) =>
  getJson(`/api/${city}/stops/${encodeURIComponent(stopCode)}/schedule?lang=${lang}`, signal);

export const fetchRouteSequence = (city, routeCode, signal) =>
  getJson(`/api/${city}/routes/${encodeURIComponent(routeCode)}/sequence`, signal);

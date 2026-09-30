// How long a request may take before it is given up. Nothing had a limit, and a
// request that never settles (a dead cell handover, captive Wi-Fi) is what a phone
// gets: it stopped a stop's polling for good (`inFlight` never cleared), Refresh
// did nothing, and the stop list said "Loading stops…" forever. The stop list is
// ~120 KB, so it gets longer.
const TIMEOUT_MS = 15_000;
const LIVE_TIMEOUT_MS = 12_000;
const STOPS_TIMEOUT_MS = 20_000;

async function getJson(path, signal, timeoutMs = TIMEOUT_MS) {
  // The caller's signal and the timeout are combined by hand: AbortSignal.any is
  // too new (Chrome 116, Safari 17.4).
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', forwardAbort);

  try {
    const res = await fetch(path, { signal: controller.signal, headers: { accept: 'application/json' } });
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
    return await res.json();
  } catch (err) {
    // Every hook ignores AbortError on purpose, as the sign of its own cleanup, so a
    // timeout must not look like one: it would hang exactly as before, silently.
    if (timedOut) {
      const error = new Error('The request timed out');
      error.name = 'TimeoutError';
      throw error;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

export const fetchConfig = (signal) => getJson('/api/config', signal);
export const fetchCities = (signal) => getJson('/api/cities', signal);

export const fetchStops = (city, lang, signal) =>
  getJson(`/api/${city}/stops?lang=${lang}`, signal, STOPS_TIMEOUT_MS);

export const fetchLiveArrivals = (city, lang, stopCode, signal) =>
  getJson(`/api/${city}/stops/${encodeURIComponent(stopCode)}/live?lang=${lang}`, signal, LIVE_TIMEOUT_MS);

export const fetchRouteShape = (city, lineCode, routeCode, signal) =>
  getJson(
    `/api/${city}/lines/${encodeURIComponent(lineCode)}/routes/${encodeURIComponent(routeCode)}/shape`,
    signal,
  );

export const fetchSchedule = (city, lang, stopCode, signal) =>
  getJson(`/api/${city}/stops/${encodeURIComponent(stopCode)}/schedule?lang=${lang}`, signal, LIVE_TIMEOUT_MS);

export const fetchRouteSequence = (city, routeCode, signal) =>
  getJson(`/api/${city}/routes/${encodeURIComponent(routeCode)}/sequence`, signal);

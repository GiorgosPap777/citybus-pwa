import { TtlCache } from './cache.js';

const REST_BASE = 'https://rest.citybus.gr';
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const CACHE_DIR = process.env.CACHE_DIR || '.cache';

// Stops and lines change on the order of timetable revisions, not minutes.
const STATIC_TTL_MS = 24 * 60 * 60 * 1000;
// Live arrivals: short enough to feel live, long enough that N clients polling the
// same stop collapse into one upstream call. This is the politeness valve.
const LIVE_TTL_MS = 10 * 1000;
// Tokens are valid 48h; renew an hour early rather than racing the expiry.
const TOKEN_SKEW_MS = 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 10_000;

const siteCache = new TtlCache({ name: 'sites', dir: CACHE_DIR });
const staticCache = new TtlCache({ name: 'static', dir: CACHE_DIR });
const liveCache = new TtlCache({ name: 'live' }); // memory only, by design

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Slugs are interpolated into a hostname, so the charset must be locked down.
 * Restricting to [a-z0-9-] means the result can only ever be a citybus.gr
 * subdomain — no dots, no slashes, no way to point the fetch somewhere else.
 */
export function assertSlug(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{1,40}$/.test(slug)) {
    throw new HttpError(400, `Invalid city slug: ${slug}`);
  }
  return slug;
}

export function assertLang(lang) {
  if (lang !== 'el' && lang !== 'en') {
    throw new HttpError(400, `Invalid language: ${lang} (expected "el" or "en")`);
  }
  return lang;
}

export function assertStopCode(code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/.test(code)) {
    throw new HttpError(400, `Invalid stop code: ${code}`);
  }
  return code;
}

function decodeTokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Each city's own site embeds everything we need to talk to the API on its behalf:
 * a bearer token and the numeric agency code. Scraping both from the same page is
 * what lets any citybus.gr city work without a hardcoded lookup table.
 */
async function fetchSite(slug) {
  const url = `https://${slug}.citybus.gr/el/stops`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'el,en-US;q=0.7,en;q=0.3',
        'user-agent': BROWSER_UA,
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    throw new HttpError(502, `Could not reach ${slug}.citybus.gr: ${err.message}`);
  }

  if (res.status === 404) throw new HttpError(404, `No citybus site for city "${slug}"`);
  if (!res.ok) throw new HttpError(502, `${slug}.citybus.gr returned ${res.status}`);

  const html = await res.text();
  const token = html.match(/const\s+token\s*=\s*'([^']*)'/)?.[1];
  const agencyCode = html.match(/agencyCode\s*=\s*(\d+)/)?.[1];

  if (!token || !agencyCode) {
    throw new HttpError(
      502,
      `Could not read token/agencyCode from ${slug}.citybus.gr — the upstream page layout may have changed`,
    );
  }

  return { slug, agencyCode, token, expiresAt: decodeTokenExpiry(token) };
}

export function getSite(slug, { force = false } = {}) {
  assertSlug(slug);
  if (force) siteCache.delete(slug);
  return siteCache.wrap(slug, (site) => {
    if (!site.expiresAt) return 6 * 60 * 60 * 1000; // no exp claim: re-check periodically
    return Math.max(60_000, site.expiresAt - Date.now() - TOKEN_SKEW_MS);
  }, () => fetchSite(slug));
}

function upstreamFetch(site, path) {
  const origin = `https://${site.slug}.citybus.gr`;
  return fetch(`${REST_BASE}${path}`, {
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      authorization: `Bearer ${site.token}`,
      origin,
      referer: `${origin}/`,
      'user-agent': BROWSER_UA,
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

/**
 * `buildPath` takes the agency code so a token refresh can rebuild the URL —
 * in principle a refresh could return a different agency code for the same city.
 * On 401 we refresh once and retry exactly once; never loop.
 */
async function apiGet(slug, buildPath) {
  let site = await getSite(slug);
  let res;
  try {
    res = await upstreamFetch(site, buildPath(site.agencyCode));
  } catch (err) {
    throw new HttpError(502, `Upstream request failed: ${err.message}`);
  }

  if (res.status === 401) {
    site = await getSite(slug, { force: true });
    try {
      res = await upstreamFetch(site, buildPath(site.agencyCode));
    } catch (err) {
      throw new HttpError(502, `Upstream request failed after token refresh: ${err.message}`);
    }
  }

  if (res.status === 404) throw new HttpError(404, 'Not found upstream');
  if (!res.ok) throw new HttpError(502, `Upstream returned ${res.status}`);

  try {
    return await res.json();
  } catch (err) {
    throw new HttpError(502, `Upstream returned invalid JSON: ${err.message}`);
  }
}

export function getStops(slug, lang) {
  assertSlug(slug);
  assertLang(lang);
  return staticCache.wrap(`stops:${slug}:${lang}`, STATIC_TTL_MS, () =>
    apiGet(slug, (agency) => `/api/v1/${lang}/${agency}/stops`),
  );
}

export function getLines(slug, lang) {
  assertSlug(slug);
  assertLang(lang);
  return staticCache.wrap(`lines:${slug}:${lang}`, STATIC_TTL_MS, () =>
    apiGet(slug, (agency) => `/api/v1/${lang}/${agency}/lines`),
  );
}

/**
 * The upstream reports coordinates as strings here (but as numbers in /stops), and
 * uses "0" for a vehicle with no GPS fix. Both are normalised once, here, so no
 * caller has to remember either quirk.
 */
function normaliseVehicle(vehicle) {
  const latitude = Number.parseFloat(vehicle.latitude);
  const longitude = Number.parseFloat(vehicle.longitude);
  const hasPosition =
    Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude !== 0 || longitude !== 0);
  return { ...vehicle, latitude, longitude, hasPosition };
}

export function getLiveArrivals(slug, lang, stopCode) {
  assertSlug(slug);
  assertLang(lang);
  assertStopCode(stopCode);

  return liveCache.wrap(`${slug}:${lang}:${stopCode}`, LIVE_TTL_MS, async () => {
    try {
      const data = await apiGet(
        slug,
        (agency) => `/api/v1/${lang}/${agency}/stops/live/${encodeURIComponent(stopCode)}`,
      );
      return {
        vehicles: (data.vehicles ?? []).map(normaliseVehicle),
        noService: false,
        fetchedAt: Date.now(),
      };
    } catch (err) {
      // Upstream returns 404 both for an unknown stop and for a known stop with
      // nothing due in the next 30 minutes. The second is by far the common case,
      // so treat it as an empty result rather than an error and let the UI say so.
      if (err.status === 404) return { vehicles: [], noService: true, fetchedAt: Date.now() };
      throw err;
    }
  });
}

/** Agency code for a city, if we happen to have it cached already. Never fetches. */
export function peekAgencyCode(slug) {
  return siteCache.get(slug)?.agencyCode ?? null;
}

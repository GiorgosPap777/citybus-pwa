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
// A stop's timetable for a given weekday is fixed; the TTL only has to be shorter
// than a week so the same weekday number next week is fetched afresh.
const SCHEDULE_TTL_MS = 12 * 60 * 60 * 1000;
const SCHEDULE_LIMIT = 8;
// Every citybus.gr city is in Greece, and trip times are local wall-clock times.
// Deriving "today" from the host clock would be wrong in a UTC container.
const SERVICE_TZ = 'Europe/Athens';

// Failures are cached too, so single-flight collapses them like answers. A 404 is
// an answer (no such city or line) and keeps; anything else is likely transient
// and is kept only long enough to absorb a burst of polls.
const failureTtl = (err) => (err.status === 404 ? 10 * 60 * 1000 : 5_000);

// The caps bound memory: stop codes are user input, so the keys are too. Each is
// far above what normal use reaches — every city and language fits in `static`.
const siteCache = new TtlCache({ name: 'sites', dir: CACHE_DIR, maxEntries: 100, failureTtl });
const staticCache = new TtlCache({ name: 'static', dir: CACHE_DIR, maxEntries: 200, failureTtl });
// Memory only, by design.
const liveCache = new TtlCache({ name: 'live', maxEntries: 2000, failureTtl });
// Memory only: one entry per stop and weekday is too many small writes for disk.
const scheduleCache = new TtlCache({ name: 'schedule', maxEntries: 500, failureTtl });
// Memory only: shapes are cheap to rebuild and would bloat the static cache file.
const shapeCache = new TtlCache({ name: 'shapes', maxEntries: 300, failureTtl });

// A ceiling on requests to citybus.gr from this server, shared by all users. The
// caches keep normal use far below it; it exists so that nobody can use the proxy
// to hammer the upstream by cycling uncached stop codes or city names, since it is
// this server's address that would be blocked. It is global, not per client: behind
// a reverse proxy and mobile carrier NAT one address can be many people, and what
// it protects is the upstream, which is the same whoever asks.
const UPSTREAM_PER_SECOND = 10;
const UPSTREAM_BURST = 50;
let upstreamBudget = UPSTREAM_BURST;
let upstreamBudgetAt = Date.now();

function spendUpstreamBudget() {
  const now = Date.now();
  upstreamBudget = Math.min(
    UPSTREAM_BURST,
    upstreamBudget + ((now - upstreamBudgetAt) / 1000) * UPSTREAM_PER_SECOND,
  );
  upstreamBudgetAt = now;
  if (upstreamBudget < 1) throw new HttpError(503, 'Too many upstream requests; try again shortly');
  upstreamBudget -= 1;
}
// Route polylines are simplified to this tolerance before they leave the server.
// It cuts a typical route from ~900 points to ~120 (86 KB upstream to ~2 KB sent)
// with no visible change at street zoom — which matters when the server sits on a
// home uplink.
const SHAPE_TOLERANCE_M = 4;

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

/** Stop, line and route codes all land in an upstream URL path, so all get the same lock. */
function assertCode(code, kind) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/.test(code)) {
    throw new HttpError(400, `Invalid ${kind} code: ${code}`);
  }
  return code;
}

export const assertStopCode = (code) => assertCode(code, 'stop');

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
  spendUpstreamBudget();
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

  // An unknown subdomain 302s to the citybus.gr landing page, which fetch follows
  // silently. Without this check that page's missing token is reported as a layout
  // change (502) instead of what it is: no such city.
  if (res.status === 404 || new URL(res.url).hostname !== `${slug}.citybus.gr`) {
    throw new HttpError(404, `No citybus site for city "${slug}"`);
  }
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
  spendUpstreamBudget();
  let res;
  try {
    res = await upstreamFetch(site, buildPath(site.agencyCode));
  } catch (err) {
    throw new HttpError(502, `Upstream request failed: ${err.message}`);
  }

  if (res.status === 401) {
    // Logged because it is the one path that otherwise only shows itself every 48h.
    console.log(`[citybus] ${slug}: token rejected, fetching a new one`);
    site = await getSite(slug, { force: true });
    spendUpstreamBudget();
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

export async function getStops(slug, lang) {
  assertSlug(slug);
  assertLang(lang);
  const stops = await staticCache.wrap(`stops:${slug}:${lang}`, STATIC_TTL_MS, () =>
    apiGet(slug, (agency) => `/api/v1/${lang}/${agency}/stops`),
  );
  // Applied after the cache rather than inside it so entries cached before this
  // existed are repaired too, not served nameless until they expire.
  return fillMissingNames(slug, lang, stops);
}

/**
 * The English feed has gaps: a few stops come back with `name: null` (two in
 * Heraklion as of 2026-09). A nameless stop crashed the client's search outright,
 * so borrow the Greek name, which has been complete, and fall back to the code.
 */
async function fillMissingNames(slug, lang, stops) {
  if (stops.every((stop) => stop.name)) return stops;
  const greek = lang === 'el' ? [] : await getStops(slug, 'el').catch(() => []);
  const greekNames = new Map(greek.map((stop) => [stop.code, stop.name]));
  return stops.map((stop) =>
    stop.name ? stop : { ...stop, name: greekNames.get(stop.code) || stop.code },
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

/**
 * Today's date, weekday (0 = Sunday, as the upstream numbers them) and minute of
 * day, in Greece. Numeric parts only: a weekday read back from a locale's names
 * breaks the day a locale changes an abbreviation, as en-GB has done for months.
 */
function serviceClock(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: SERVICE_TZ,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, Number(p.value)]),
  );
  const { year, month, day, hour, minute } = parts;
  return {
    date: { year, month, day },
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    minute: hour * 60 + minute,
    // How far Greek wall-clock time is ahead of UTC at this instant.
    offsetMs: Date.UTC(year, month - 1, day, hour, minute) - (date.getTime() - (date.getTime() % 60_000)),
  };
}

/**
 * The instant a Greek wall-clock time happens. The offset is looked up for that
 * date rather than taken from now: on the Saturday before summer time ends,
 * Sunday's departures are an hour further away than a constant offset says, and
 * the client drops each one an hour before it leaves. `minute` may run past
 * midnight; Date.UTC carries it into the next day.
 */
function serviceInstant({ year, month, day }, minute) {
  const wall = Date.UTC(year, month - 1, day, 0, minute);
  const guess = wall - serviceClock(new Date(wall)).offsetMs;
  return wall - serviceClock(new Date(guess)).offsetMs;
}

function nextDate({ year, month, day }) {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

/**
 * One weekday's timetable for a stop, trimmed to what the UI shows — the raw
 * payload is ~90 KB for a busy stop, mostly the stop's own name repeated per trip.
 * The upstream numbers days 0 (Sunday) to 6 and answers 404 for a stop with no
 * trips that day, which is an empty timetable rather than an error.
 */
function getDayTimetable(slug, lang, stopCode, day) {
  return scheduleCache.wrap(`${slug}:${lang}:${stopCode}:${day}`, SCHEDULE_TTL_MS, async () => {
    let trips;
    try {
      trips = await apiGet(
        slug,
        (agency) => `/api/v1/${lang}/${agency}/trips/stop/${encodeURIComponent(stopCode)}/day/${day}`,
      );
    } catch (err) {
      if (err.status === 404) return [];
      throw err;
    }
    return trips
      .map((trip) => ({
        minute: trip.tripTimeHour * 60 + trip.tripTimeMinute,
        time: trip.tripTime,
        lineCode: trip.lineCode,
        lineName: trip.lineName,
        routeName: trip.routeName,
        lineColor: trip.lineColor,
        lineTextColor: trip.lineTextColor,
      }))
      .sort((a, b) => a.minute - b.minute);
  });
}

/**
 * The next few timetabled departures from a stop. Live arrivals only reach 30
 * minutes ahead, so this is what fills the gap when nothing is due — late at
 * night, or on a line that runs hourly. Rolls into tomorrow when today runs out.
 */
export async function getSchedule(slug, lang, stopCode) {
  assertSlug(slug);
  assertLang(lang);
  assertStopCode(stopCode);

  const now = Date.now();
  const clock = serviceClock(new Date(now));
  // Absolute times let the client drop departures as they pass without refetching.

  const today = await getDayTimetable(slug, lang, stopCode, clock.weekday);
  const departures = today
    .filter((trip) => trip.minute >= clock.minute)
    .slice(0, SCHEDULE_LIMIT)
    .map(({ minute, ...trip }) => ({
      ...trip,
      departsAt: serviceInstant(clock.date, minute),
      tomorrow: false,
    }));

  if (departures.length < SCHEDULE_LIMIT) {
    const tomorrow = await getDayTimetable(slug, lang, stopCode, (clock.weekday + 1) % 7);
    const date = nextDate(clock.date);
    for (const { minute, ...trip } of tomorrow.slice(0, SCHEDULE_LIMIT - departures.length)) {
      departures.push({ ...trip, departsAt: serviceInstant(date, minute), tomorrow: true });
    }
  }

  return { departures, fetchedAt: now };
}

/**
 * Douglas–Peucker on [lat, lon] pairs. Longitude is scaled by cos(latitude) so the
 * tolerance means the same distance in both directions; at Greek latitudes an
 * unscaled degree of longitude is ~20% shorter than one of latitude.
 */
function simplifyLine(points, toleranceM) {
  if (points.length < 3) return points;
  const tolerance = toleranceM / 111_320; // metres to degrees of latitude
  const k = Math.cos((points[0][0] * Math.PI) / 180);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ay = points[a][0], ax = points[a][1] * k;
    const dy = points[b][0] - ay, dx = points[b][1] * k - ax;
    const lengthSq = dx * dx + dy * dy;
    let worst = 0, worstAt = -1;
    for (let i = a + 1; i < b; i++) {
      const py = points[i][0] - ay, px = points[i][1] * k - ax;
      const t = lengthSq ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq)) : 0;
      const distance = Math.hypot(px - t * dx, py - t * dy);
      if (distance > worst) [worst, worstAt] = [distance, i];
    }
    if (worst > tolerance) {
      keep[worstAt] = 1;
      stack.push([a, worstAt], [worstAt, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * The street path one route of a line follows, as [[lat, lon], …]. The upstream
 * serves every route of a line in one payload (up to ~530 KB), with coordinates as
 * strings, so the whole line is fetched once, simplified, and cached per route.
 * Note the upstream path has no {lang} segment, unlike every other endpoint.
 */
export async function getRouteShape(slug, lineCode, routeCode) {
  assertSlug(slug);
  assertCode(lineCode, 'line');
  assertCode(routeCode, 'route');

  const routes = await shapeCache.wrap(`${slug}:${lineCode}`, STATIC_TTL_MS, async () => {
    const data = await apiGet(
      slug,
      (agency) => `/api/v1/${agency}/lines/${encodeURIComponent(lineCode)}/points`,
    );
    return Object.fromEntries(
      data.map((route) => {
        const points = [...route.routePoints]
          .sort((a, b) => a.sequence - b.sequence)
          .map((p) => [Number(Number(p.latitude).toFixed(5)), Number(Number(p.longitude).toFixed(5))])
          .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon));
        return [route.routeCode, simplifyLine(points, SHAPE_TOLERANCE_M)];
      }),
    );
  });

  const points = routes[routeCode];
  if (!points) throw new HttpError(404, `Route ${routeCode} not found on line ${lineCode}`);
  return { lineCode, routeCode, points };
}

/** Agency code for a city, if we happen to have it cached already. Never fetches. */
export function peekAgencyCode(slug) {
  return siteCache.get(slug)?.agencyCode ?? null;
}

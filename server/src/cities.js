import { TtlCache } from './cache.js';
import { peekAgencyCode, peekNoData } from './citybus.js';

const CACHE_DIR = process.env.CACHE_DIR || '.cache';
const CITIES_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const citiesCache = new TtlCache({ name: 'cities', dir: CACHE_DIR });

/**
 * Used only if citybus.gr is unreachable or restructures its landing page.
 * The live scrape below is the source of truth; this just keeps the city picker
 * populated when it fails.
 */
const SEED_SLUGS = [
  'agrinio', 'alexandroupoli', 'arta', 'chalkida', 'chania', 'chios', 'corfu',
  'drama', 'ioannina', 'irakleio', 'kastoria', 'katerini', 'kavala', 'komotini',
  'kozani', 'lamia', 'larisa', 'mesologgi', 'mitilini', 'naousa', 'patra',
  'ptolemaida', 'salamina', 'serres', 'skiathos', 'trikala', 'veroia', 'volos',
  'xanthi', 'yper-xanthi',
];

/**
 * The area each city's stops cover, as [south, west, north, east], from the stop
 * lists of 2026-09-30 rounded outward. It lets the client notice that the user is
 * in another city and offer to switch, without fetching 28 stop lists to find out.
 * A city missing here is simply never suggested; add it when you notice one.
 * trikala and yper-xanthi have no stops to measure.
 */
const CITY_BOUNDS = {
  agrinio: [38.52, 20.89, 38.79, 21.62],
  alexandroupoli: [40.84, 25.67, 41.02, 26.05],
  arta: [39.01, 20.86, 39.19, 21.09],
  chalkida: [38.35, 23.51, 38.53, 23.70],
  chania: [35.47, 23.95, 35.55, 24.10],
  chios: [38.30, 26.07, 38.43, 26.16],
  corfu: [39.52, 19.80, 39.71, 19.93],
  drama: [41.09, 24.06, 41.20, 24.23],
  ioannina: [39.53, 20.72, 39.77, 20.98],
  irakleio: [35.24, 25.04, 35.35, 25.22],
  kastoria: [40.48, 21.13, 40.58, 21.33],
  katerini: [40.16, 22.39, 40.34, 22.60],
  kavala: [40.92, 24.37, 40.96, 24.45],
  komotini: [41.00, 25.27, 41.18, 25.54],
  kozani: [40.17, 21.69, 40.36, 21.92],
  lamia: [38.80, 22.35, 38.94, 22.52],
  larisa: [39.56, 22.29, 39.78, 22.51],
  mesologgi: [38.34, 21.23, 38.50, 21.60],
  mitilini: [39.01, 26.40, 39.19, 26.62],
  naousa: [40.60, 22.01, 40.72, 22.26],
  patra: [38.15, 21.63, 38.32, 21.84],
  ptolemaida: [40.45, 21.53, 40.61, 21.86],
  salamina: [37.87, 23.41, 38.01, 23.55],
  serres: [40.99, 23.45, 41.12, 23.65],
  skiathos: [39.07, 23.39, 39.20, 23.75],
  veroia: [40.46, 22.14, 40.61, 22.32],
  volos: [39.30, 22.89, 39.40, 23.06],
  xanthi: [41.05, 24.84, 41.15, 24.95],
};

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * The landing page lays each operator out as a card: an <h4 class="card-header">
 * holding the name, then a link to that city's subdomain. Walk both patterns in
 * document order and pair each link with the heading above it.
 */
function parseCities(html) {
  const pattern =
    /<h4[^>]*class="[^"]*card-header[^"]*"[^>]*>\s*<span>([\s\S]*?)<\/span>\s*<\/h4>|https:\/\/([a-z0-9-]+)\.citybus\.gr/g;

  const found = new Map();
  let heading = null;

  for (const match of html.matchAll(pattern)) {
    if (match[1] !== undefined) {
      heading = decodeEntities(match[1]).replace(/\s+/g, ' ').trim();
    } else if (match[2] && !found.has(match[2])) {
      found.set(match[2], { slug: match[2], name: heading || titleCase(match[2]) });
    }
  }
  return [...found.values()];
}

function titleCase(slug) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function scrapeCities() {
  try {
    const res = await fetch('https://citybus.gr', {
      headers: { 'user-agent': BROWSER_UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const cities = parseCities(await res.text());
      if (cities.length > 0) return cities.sort((a, b) => a.slug.localeCompare(b.slug));
    }
    console.warn('[cities] scrape returned nothing usable; falling back to seed list');
  } catch (err) {
    console.warn(`[cities] scrape failed (${err.message}); falling back to seed list`);
  }
  return SEED_SLUGS.map((slug) => ({ slug, name: titleCase(slug) }));
}

/**
 * Agency codes are attached only when already known — resolving all of them would
 * mean ~30 extra upstream page fetches for a list the UI can render without them.
 * Each city's code is discovered on first use and appears here from then on.
 * `noData` works the same way: true once a city has been tried and found empty.
 */
export async function getCities() {
  const cities = await citiesCache.wrap('all', CITIES_TTL_MS, scrapeCities);
  return cities.map((city) => ({
    ...city,
    agencyCode: peekAgencyCode(city.slug),
    noData: peekNoData(city.slug),
    bounds: CITY_BOUNDS[city.slug] ?? null,
  }));
}

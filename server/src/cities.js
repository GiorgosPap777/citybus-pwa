import { TtlCache } from './cache.js';
import { peekAgencyCode } from './citybus.js';

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
 */
export async function getCities() {
  const cities = await citiesCache.wrap('all', CITIES_TTL_MS, scrapeCities);
  return cities.map((city) => ({ ...city, agencyCode: peekAgencyCode(city.slug) }));
}

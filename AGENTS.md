# AGENTS.md

Orientation for an AI agent or developer picking this repo up cold. Everything here was derived by
probing the live API — it is not in any public documentation. **Read the "Load-bearing decisions"
section before changing anything**; several pieces of this code look over-engineered and are not.

## What this is

An installable PWA for the `citybus.gr` live bus network: pick a stop on a map, see minutes until
each bus arrives, and watch approaching buses move. Defaults to Heraklion (`irakleio`, agency `110`);
28 of the 30 cities on the platform work with no configuration (see *City coverage*).

Two parts, one process in production:

| Path | What it is |
|---|---|
| `server/` | Node + Express. Proxies the upstream API, manages tokens, caches. Serves `web/dist`. |
| `web/` | React 19 + Vite + Leaflet PWA. |

---

## The upstream API

Base: `https://rest.citybus.gr`. Auth: `Authorization: Bearer <jwt>`.

### CORS is why the server exists

This is the single most important fact in the repo.

```
$ curl -i -X OPTIONS 'https://rest.citybus.gr/api/v1/el/110/stops' \
    -H 'origin: https://irakleio.citybus.gr' -H 'access-control-request-method: GET'
access-control-allow-origin: https://irakleio.citybus.gr
vary: Origin
```

From **any other origin the response carries no CORS headers at all**. A browser therefore cannot
call this API directly, from any domain you control. `curl` appears to work because curl does not
enforce CORS — do not let that mislead you into thinking the proxy is removable. **It is not.**

The upstream does not validate `Origin` server-side (requests with a wrong origin still return 200);
only the CORS response headers differ. We send the correct origin anyway.

### Tokens

Each city's own site embeds a bearer token in its HTML:

```
https://{slug}.citybus.gr/el/stops   →   const token = '<jwt>'
                                     →   agencyCode = <number>
```

- The JWT's only claim is `exp`. Lifetime is **48 hours** from issue.
- Both values come from the same page fetch, which is what makes any-city support automatic —
  there is no hardcoded city→code table anywhere, by design.
- Confirmed codes: irakleio 110, chania 120, patra 112, volos 103, larisa 102, corfu 101.

All of this lives in `server/src/citybus.js`. If the upstream changes its page layout, that one file
is the blast radius.

### City coverage

Surveyed 2026-09-01 by requesting `/api/{slug}/stops` for every slug on the citybus.gr landing page.
**28 of 30 return data.** Stop counts, useful as regression baselines:

| | | | |
|---|---|---|---|
| agrinio 460 | alexandroupoli 318 | arta 351 | chalkida 489 |
| chania 474 | chios 377 | corfu 485 | drama 402 |
| ioannina 406 | irakleio 496 | kastoria 209 | katerini 508 |
| kavala 216 | komotini 219 | kozani 351 | lamia 489 |
| larisa 520 | mesologgi 85 | mitilini 338 | naousa 266 |
| patra 813 | ptolemaida 182 | salamina 420 | serres 342 |
| skiathos 154 | veroia 429 | volos 424 | xanthi 160 |

**`trikala` (119) and `yper-xanthi` (111) do not work.** Their sites exist and serve a valid token
and agency code, but the API has no data for those agencies — `/stops` *and* `/lines` both return
404. This is an upstream gap; there is nothing to fix here. They still appear in the city picker
because that list is scraped from citybus.gr, and the UI shows the `cityUnavailable` string.

Re-run the survey with:

```bash
curl -s localhost:3000/api/cities \
  | python3 -c "import json,sys;[print(c['slug']) for c in json.load(sys.stdin)]" \
  | while read -r s; do printf '%-18s ' "$s"; curl -s "localhost:3000/api/$s/stops" \
      | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(d) if isinstance(d,list) else 'FAIL')"; done
```

Note the `isinstance(d, list)` check — a failing city returns a JSON **object** (`{"error": ...}`),
so a naive `len()` reports a plausible-looking small number instead of an error.

### Endpoints

`{lang}` is `el` or `en`; both are fully populated (English returns translated stop and line names).
`{agency}` is the numeric agency code.

| Endpoint | Returns | Used? |
|---|---|---|
| `/api/v1/{lang}/{agency}/stops` | all stops: `code`, `name`, `latitude`, `longitude`, `lineCodes[]`, `routeCodes[]` | yes |
| `/api/v1/{lang}/{agency}/stops/live/{code}` | `vehicles[]`: `lineCode`, `lineName`, `routeName`, `latitude`, `longitude`, `departureMins`, `departureSeconds`, `vehicleCode`, `lineColor`, `lineTextColor`, `borderColor` | yes |
| `/api/v1/{lang}/{agency}/lines` | lines with nested `routes[]` and colours | proxied, unused by UI |
| `/api/v1/{agency}/lines/{line}/points` | route polylines. **No `{lang}` segment** — easy to get wrong | no |
| `/api/v1/{lang}/{agency}/routes/{route}/sequence` | ordered stop codes for a route | no |
| `/api/v1/{lang}/{agency}/trips/stop/{code}/day/{day}` | scheduled departures | no |

Sizes for Heraklion: stops 107 KB / 496 entries, lines 12 KB / 26 entries, **line points 530 KB for a
single line** — lazy-load that one if you ever wire it up.

Status codes: `200` ok · `401` missing or expired token · `404` unknown stop **or** no buses due in
the next 30 minutes. Those two 404 meanings are not distinguishable, and the second is far more
common, so the server maps 404 to `{ vehicles: [], noService: true }` rather than an error.

No rate limiting was observed across 12 rapid calls, but see the caching note below — do not remove
it on the strength of that.

### Two data quirks

Both are normalised in `server/src/citybus.js` so nothing downstream has to know:

1. `latitude`/`longitude` are **numbers** in `/stops` but **strings** in `/stops/live`.
2. A bus with no GPS fix reports latitude `"0"`. Those get `hasPosition: false`. They still belong in
   the arrivals list — the ETA is valid — but must not be drawn on the map.

---

## Our own API

Same-origin with the SPA in production; Vite proxies `/api` to port 3000 in development.

```
GET /api/health                             {ok:true}
GET /api/config                             {defaultCity, defaultLang}
GET /api/cities                             [{slug, name, agencyCode|null}]
GET /api/:city/stops?lang=el                upstream stops, cached 24h
GET /api/:city/lines?lang=el                upstream lines, cached 24h
GET /api/:city/stops/:code/live?lang=el     {vehicles[], noService, fetchedAt}, cached 10s
```

`agencyCode` in `/api/cities` is `null` until that city has actually been used. Resolving all 30
eagerly would mean 30 extra page fetches for a field the UI does not need.

### Input validation is a security control, not politeness

`assertSlug` restricts city slugs to `[a-z0-9-]{1,40}`. The slug is interpolated into
`https://{slug}.citybus.gr`, so allowing a dot or slash would let a caller redirect that fetch to an
arbitrary host — SSRF. Do not relax it. `assertStopCode` and `assertLang` exist for the same reason.

---

## Load-bearing decisions

Each of these fixes a bug that was observed, not hypothesised. Simplifying them reintroduces the bug.

### 1. The 10-second live cache (`LIVE_TTL_MS`, `server/src/citybus.js`)

Collapses N clients polling the same stop into one upstream request per 10s. With the app shared
around a city this is the difference between neighbourly and abusive. The `TtlCache.wrap` single-
flight path matters for the same reason: concurrent misses on one key share a single upstream call
rather than stampeding.

The live cache is deliberately **memory-only** (`new TtlCache({ name: 'live' })`, no `dir`) — the
static caches persist to disk, but writing a file every 10 seconds would be silly.

### 2. Poll scheduling in `web/src/hooks/useLiveArrivals.js`

Observed bug: resuming from background started a new poll chain without cancelling the pending one.
Six app switches produced **22 requests instead of 6**, and the rate compounded with every switch —
on a phone, where app switching is constant, this is a battery burner.

Three things keep it correct, all of which look redundant and are not:

- `cycle()` clears the pending timer before starting, and an `inFlight` flag stops overlapping runs.
- `onVisibilityChange` acts **only on a real `hidden` → `visible` transition** (`wasHidden`). Some
  environments fire `visibilitychange` repeatedly without the state changing; reacting to each turns
  a 15s poll into a flood.
- `MIN_REFRESH_GAP_MS` (3s) floors the interval between fetches however many resume events arrive.

Verified: pure polling is 2 requests per 33 seconds. Keep it that way.

### 3. `useStops` withholds stops from a previous city

Observed bug: switching city left the map framed on the old city forever.

React re-renders with the new `city` **one tick before** the fetch effect replaces the data. For that
tick the hook still held the previous city's stops. `StopMap` framed itself on them and stamped
`fittedFor = <new city>`, so when the real stops arrived the guard blocked the refit permanently.

The fix is at the source: `useStops` compares `state.city`/`state.lang` against the requested ones
and returns `[]` plus `loading: true` when they disagree. Do not "optimise" that check away — and
prefer this shape over patching consumers, since any other consumer of stale stops has the same bug.

### 4. Leaflet size handling in `web/src/components/StopMap.jsx`

Leaflet measures its container once at init and then only on a window `resize`. Observed bug: a stale
zero size made `fitBounds` resolve to max zoom (19), stranding all 496 stops off-screen.

- `KeepSizeInSync` runs `invalidateSize()` from a `ResizeObserver`. On a phone this is what handles
  rotation, the on-screen keyboard, and browser chrome collapsing — none of which fire `resize`.
- `FitToStops` calls `invalidateSize()` and refuses to fit until the container exceeds 80×80,
  retrying over up to 10 animation frames.

### 5. Map insets (`TOP_INSET`, `SHEET_INSET`)

The top bar and bottom sheet float **over** the map, so centring anything puts it behind the sheet.
Both the initial fit and `PanTo` steer targets into the visible band between them. `PanTo` shifts the
centre down by half the hidden height rather than centring on the target.

---

## Conventions

- ES modules everywhere, `type: "module"` in both packages. Node ≥ 20.12 (uses native `fetch` and
  `--env-file-if-exists`).
- No test framework is set up. Verification is done against the live API with the recipes below.
- Comments explain **why**, not what. The load-bearing bits above carry comments saying what breaks
  if they are removed — preserve that when editing.
- The server has one runtime dependency (`express`) on purpose. Keep the dependency surface small.
- All upstream contact is confined to `server/src/citybus.js`. Keep it that way, so an upstream change
  is a one-file fix.
- User-facing strings live in `web/src/i18n.js` and must be added in **both** `el` and `en`. Greek is
  the default; the language is also passed to the API so stop and line names translate.

## File map

```
server/src/
  index.js     routes, static hosting, error middleware
  citybus.js   ALL upstream contact: token + agency discovery, validation, normalisation
  cities.js    scrapes the citybus.gr landing page for the city list (seed list as fallback)
  cache.js     TTL cache: single-flight, optional disk persistence
web/src/
  App.jsx      state orchestration; owns city/lang/selectedStop/panTarget/sheet mode
  api.js       thin fetch wrappers over /api
  geo.js       haversine distance, nearest-stops sort, distance formatting
  i18n.js      el/en strings
  storage.js   localStorage guarded against private-mode throws
  components/  StopMap · StopSheet · HomePanel · SettingsSheet
  hooks/       useStops · useLiveArrivals · useGeolocation · useFavourites · usePersistentState
```

## Verifying changes

Start the server (`cd server && npm run dev`), then:

```bash
curl -s localhost:3000/api/irakleio/stops | python3 -c "import json,sys;print(len(json.load(sys.stdin)))"
```

Expected results:

- `/api/cities` → 30 · `/api/irakleio/stops` → 496 · `/api/chania/stops` → 474 · `/api/patra/stops` → 813
- `/api/irakleio/stops/0122/live` → live vehicles (`0122` is a busy central stop, good for testing)
- `/api/irakleio/stops/9999/live` → `{"vehicles":[],"noService":true}`
- `/api/evil.com/stops` → 400, `/api/irakleio/stops/..%2f..%2fetc/live` → 400
- **Any-city check:** request a city never used before; it must work with no code change. That is the
  auto-discovery guarantee and it is easy to break.

Token refresh (the path that otherwise only fails in 48 hours): stop the server, corrupt the
signature of a token in `server/.cache/sites.json` while leaving its `exp` intact, restart, and
request live arrivals. It must return data — one refresh, one retry, no loop.

Front end: `cd web && npm run build`, then load `localhost:3000` and confirm the map frames the city,
a stop opens with arrivals, and buses appear as coloured markers.

## Releasing

The app is published as a Docker image: **`giorgospap777/citybus-pwa`**
(https://hub.docker.com/r/giorgospap777/citybus-pwa). `docker-compose.yml` pulls it rather than
building, so deploying is a pull, not a build on the target host.

To cut a release:

```bash
docker build -t giorgospap777/citybus-pwa:1.1.0 -t giorgospap777/citybus-pwa:latest .
docker push giorgospap777/citybus-pwa:1.1.0
docker push giorgospap777/citybus-pwa:latest
```

Always move both tags. Pushing only `latest` leaves no way to roll back a bad build.

Before pushing, run the image and check it end to end — the build succeeding proves very little
on its own:

```bash
docker run -d --name citybus-test -p 3200:3000 giorgospap777/citybus-pwa:1.1.0
curl -s localhost:3200/api/health                          # {"ok":true}
curl -s localhost:3200/api/irakleio/stops/0122/live        # real vehicles
curl -sI localhost:3200/api/irakleio/stops/0122/live | grep -i cache-control   # must be no-store
docker inspect --format '{{.State.Health.Status}}' citybus-test               # healthy
docker exec citybus-test id                                # must be uid 1000 (node), not root
docker rm -f citybus-test
```

The image is `linux/amd64` only. If it ever needs to run on ARM, build with
`docker buildx build --platform linux/amd64,linux/arm64 ... --push`.


## Open items and non-goals

- **Unverified:** service-worker registration and home-screen install have only been checked by
  serving the assets correctly (`sw.js`, `manifest.webmanifest` and icons all serve with correct
  content types). Registration was blocked in the dev preview browser, so **installability still
  needs confirming on a real device over HTTPS.**
- **Not built, endpoints confirmed working:** route polylines on the map, timetables, line browsing.
  All additive — see the endpoint table.
- **HTTPS is required in production**, not cosmetic: PWA install and geolocation both need a secure
  context. `localhost` is exempt, so development needs nothing.
- **OSM tile policy:** the public tile servers ask that heavy apps not use them. `TILE_URL` is a
  constant in `StopMap.jsx` for exactly this reason.
- This is an **unofficial** client of a public API. Treat the upstream as something to be gentle
  with; that is the reasoning behind the caching, and it should survive refactors.

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

Surveyed 2026-09-29 by requesting `/api/{slug}/stops` for every slug on the citybus.gr landing page.
**28 of 30 return data.** Stop counts, useful as regression baselines:

| | | | |
|---|---|---|---|
| agrinio 832 | alexandroupoli 328 | arta 351 | chalkida 489 |
| chania 483 | chios 392 | corfu 485 | drama 402 |
| ioannina 429 | irakleio 547 | kastoria 209 | katerini 508 |
| kavala 220 | komotini 235 | kozani 351 | lamia 489 |
| larisa 532 | mesologgi 85 | mitilini 336 | naousa 266 |
| patra 847 | ptolemaida 182 | salamina 420 | serres 398 |
| skiathos 154 | veroia 429 | volos 431 | xanthi 183 |

Counts drift as operators add stops — between the 2026-09-01 and 2026-09-29 surveys Heraklion went
496 → 547 and Agrinio 460 → 832. A changed count is not a regression; a `FAIL` is.

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

`{lang}` is `el` or `en`; both are populated (English returns translated stop and line names), with
the gap noted under *Data quirks*.
`{agency}` is the numeric agency code.

| Endpoint | Returns | Used? |
|---|---|---|
| `/api/v1/{lang}/{agency}/stops` | all stops: `code`, `name`, `latitude`, `longitude`, `lineCodes[]`, `routeCodes[]` | yes |
| `/api/v1/{lang}/{agency}/stops/live/{code}` | `vehicles[]`: `lineCode`, `lineName`, `routeCode`, `routeName`, `latitude`, `longitude`, `departureMins`, `departureSeconds`, `vehicleCode`, `lineColor`, `lineTextColor`, `borderColor` | yes |
| `/api/v1/{lang}/{agency}/lines` | lines with nested `routes[]` and colours | proxied, unused by UI |
| `/api/v1/{agency}/lines/{line}/points` | `[{routeCode, routePoints[]}]`, every route of the line; each point has `sequence` and string `latitude`/`longitude`. **No `{lang}` segment** — easy to get wrong | yes, via `/shape` |
| `/api/v1/{lang}/{agency}/routes/{route}/sequence` | ordered stop codes for a route | no |
| `/api/v1/{lang}/{agency}/trips/stop/{code}/day/{day}` | one weekday's timetable for a stop: `tripTime` (`"HH:MM"`), `tripTimeHour`, `tripTimeMinute`, `lineCode`, `lineName`, `routeName`, `lineColor`, `lineTextColor`, sorted by time | yes |

Sizes for Heraklion: stops 118 KB / 547 entries, lines 12 KB / 26 entries, **line points 86 KB for a
one-route line** (line `06`: 900 points) and up to ~530 KB for a line with many routes. The server
never forwards those as-is — see `/shape` below. A busy stop's timetable is ~90 KB per day, mostly the
stop's own name repeated on every trip; the server trims it before caching.

`/trips` numbers `{day}` **0 = Sunday … 6 = Saturday** (JavaScript's `getDay()` convention); `7`
returns 400. Times are Greek wall-clock time, so the server derives "today" in `Europe/Athens`, never
from the host clock — a container runs in UTC. A stop with no trips that day returns 404, mapped to an
empty timetable.

Status codes: `200` ok · `401` missing or expired token · `404` unknown stop **or** no buses due in
the next 30 minutes. Those two 404 meanings are not distinguishable, and the second is far more
common, so the server maps 404 to `{ vehicles: [], noService: true }` rather than an error.

No rate limiting was observed across 12 rapid calls, but see the caching note below — do not remove
it on the strength of that.

### Data quirks

All are normalised in `server/src/citybus.js` so nothing downstream has to know:

1. `latitude`/`longitude` are **numbers** in `/stops` but **strings** in `/stops/live`.
2. A bus with no GPS fix reports latitude `"0"`. Those get `hasPosition: false`. They still belong in
   the arrivals list — the ETA is valid — but must not be drawn on the map.
3. The English `/stops` feed has **stops with `name: null`** (Heraklion `2196` and `0822` as of
   2026-09). Observed bug: the client's search called `.toLocaleLowerCase()` on one and the whole app
   went blank. `fillMissingNames` borrows the Greek name (then the code). It runs *after* the cache
   read, so entries cached before the fix are repaired too.

An unknown city slug is also worth knowing about: `{slug}.citybus.gr` 302s to the landing page rather
than 404ing. `fetch` follows that silently, so `fetchSite` checks the final hostname and reports 404 —
otherwise it surfaces as a misleading "page layout may have changed" 502.

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
GET /api/:city/stops/:code/schedule?lang=el {departures[], fetchedAt}, day timetables cached 12h
GET /api/:city/lines/:line/routes/:route/shape
                                            {lineCode, routeCode, points[[lat,lon]]}, cached 24h
```

`/shape` is the street path of one route, drawn when the user taps a bus. The upstream serves a whole
line at once (86–530 KB), and the production host sits on a home connection with ~5 Mbit/s of upload,
so the server splits the line by route and simplifies each path (Douglas–Peucker, 4 m tolerance,
`SHAPE_TOLERANCE_M`): line `06` goes from 900 points / 86 KB to ~120 points / ~2.4 KB with no visible
difference at street zoom. Keep payloads in that range. It is sent `public, max-age=86400`, and the
service worker keeps shapes in their own `CacheFirst` cache (`citybus-shapes`), so a route is
downloaded once a week per device, not once per tap.

`/schedule` returns the next 8 timetabled departures from now, rolling into tomorrow when today runs
out. Each has `time` (`"HH:MM"`), `departsAt` (epoch ms, so the client can drop departures as they
pass without refetching), `tomorrow`, and the line fields. It answers "when is the next bus?" where
live data (30 minutes ahead) cannot, so it is **always shown when live arrivals are empty**. Beside live
buses it sits behind a one-line toggle, open by default at a stop with 3 or fewer live buses
(`useTimetableShown`), and is requested only while shown, so opening a busy stop costs nothing extra.
Like `/live` it is `no-store`, and the service worker treats it as `NetworkOnly`: a cached "next departures"
list lists buses long gone.

`agencyCode` in `/api/cities` is `null` until that city has actually been used. Resolving all 30
eagerly would mean 30 extra page fetches for a field the UI does not need.

### Input validation is a security control, not politeness

`assertSlug` restricts city slugs to `[a-z0-9-]{1,40}`. The slug is interpolated into
`https://{slug}.citybus.gr`, so allowing a dot or slash would let a caller redirect that fetch to an
arbitrary host — SSRF. Do not relax it. `assertStopCode` and `assertLang` exist for the same reason,
and `assertCode` applies the same pattern (`[A-Za-z0-9_-]{1,20}`) to line and route codes, which are
interpolated into upstream paths.

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

### 3. `useStops` and `useLiveArrivals` withhold data from a previous city or stop

Observed bug: switching city left the map framed on the old city forever.

React re-renders with the new `city` **one tick before** the fetch effect replaces the data. For that
tick the hook still held the previous city's stops. `StopMap` framed itself on them and stamped
`fittedFor = <new city>`, so when the real stops arrived the guard blocked the refit permanently.

The fix is at the source: `useStops` compares `state.city`/`state.lang` against the requested ones
and returns `[]` plus `loading: true` when they disagree. Do not "optimise" that check away — and
prefer this shape over patching consumers, since any other consumer of stale stops has the same bug.

`useLiveArrivals` has the same tick when switching stop, so it keys its state the same way
(`city:lang:stop`). Unkeyed, going from a 4-bus stop straight to a 3-bus one renders the new stop with
the old stop's four buses, and the timetable's default is settled from that count — closed, where 3
buses should open it. Verified keyed: the new stop's first render is its loading state, and the
timetable opens. `useSchedule` and `useRouteShape` are keyed for the same reason.

### 4. Leaflet size handling in `web/src/components/StopMap.jsx`

Leaflet measures its container once at init and then only on a window `resize`. Observed bug: a stale
zero size made `fitBounds` resolve to max zoom (19), stranding all 496 stops off-screen.

- `KeepSizeInSync` runs `invalidateSize()` from a `ResizeObserver`. On a phone this is what handles
  rotation, the on-screen keyboard, and browser chrome collapsing — none of which fire `resize`.
- `FitToStops` calls `invalidateSize()` and refuses to fit until the container exceeds 80×80,
  retrying over up to 10 animation frames.

### 5. Map insets (`TOP_INSET`, `getBottomInset`)

The top bar and bottom sheet float **over** the map, so centring anything puts it behind the sheet.
Both the initial fit and `PanTo` steer targets into the visible band between them. `PanTo` shifts the
centre down by half the hidden height rather than centring on the target; a bus-plus-stop target uses
`flyToBounds` padded by the same band.

The sheet's height is **measured** (`getBottomInset` in `App.jsx`), because it collapses to a peek and
grows with its content. `SHEET_INSET` is only the fallback before the sheet exists, and below
`MIN_BAND_PX` of visible map the band logic is skipped.

Observed bug: opening a stop left it just above the sheet, and then under it. The pan is planned
against the short "loading" sheet; the arrivals arrive a moment later and the sheet grows over the
stop. So while a stop is open and expanded, `getBottomInset` returns the sheet's CSS `max-height`,
the height it can reach, rather than its current height. It reads that from the DOM (`data-mode`,
`.collapsed`) so the callback stays stable — a changing `getBottomInset` would re-run `PanTo` and
re-pan to an old target.

### 6. The collapsible sheet (`web/src/hooks/useSheetDrag.js`)

Observed problem: with a stop open the sheet covered ~60% of a phone screen and could not be moved,
so the buses it listed could not be watched on the map. The sheet now collapses to a peek — the
stop's name and one chip per bus — by dragging the handle or header down, tapping the handle, tapping
a bus, or dragging the map. It expands again on a tap or an upward drag.

- Grips use pointer events with `touch-action: none` and pointer capture. They ignore pointers that
  start on a real control (`button:not(.sheet-handle), input, select, a`), so the star and close
  buttons in a header keep working.
- The sheet follows the finger only downward. It is anchored to the bottom edge, so following an
  upward drag would open a gap beneath it.
- The handle is 32px tall with **no margin**. A margin between handle and header was a strip that
  answered neither taps nor drags; a drag starting there did nothing.
- Map drags collapse the sheet, except the settings sheet, which is modal in spirit.
- The change is animated by `useSheetCollapse`. Collapsing swaps the content, so the height changed in
  one frame; the hook records the top edge before the change (a drag offset included) and animates
  `height` from there once the new content is laid out. Height, not transform: translating a
  shrinking, bottom-anchored sheet opens a gap. While it runs, `data-rest-height` holds the height it
  is heading for, which `getBottomInset` reads so the map does not frame against a mid-animation size.
- Tapping a bus collapses the sheet, so the peek then leads with a **Back** chip. Reported: there was
  no clear way back from a bus to the stop's list — only knowing that the header expands the sheet.
  Back clears the focused bus, expands the sheet and returns the map to the stop.

### 7. Moving buses and the map's render cost (`StopMap.jsx`)

- `GlidingMarker` hands react-leaflet only the **first** position (`useState(position)`) and animates
  later ones itself over `GLIDE_MS`. react-leaflet calls `setLatLng` whenever `position` changes
  identity, which cuts every glide short. Jumps over `MAX_GLIDE_M` (a new trip or a GPS glitch) and
  `prefers-reduced-motion` skip the animation.
- Stop markers are memoised on `[stops, selectedCode, onSelectStop]`. Otherwise each 15s poll handed
  all ~550 `CircleMarker`s a new `pathOptions` object, and react-leaflet restyled every one — a full
  canvas redraw per poll. `onSelectStop` must stay a stable callback for this to hold.
- The route line and the GPS accuracy circle live in a pane at z-index 390, just below the stops
  (400), so the line never hides a tappable stop.

### 8. Geolocation is watched, but only while visible (`useGeolocation.js`)

"Near me" has to keep up with someone walking, so the hook uses `watchPosition` rather than a single
fix. A high-accuracy watch keeps the GPS powered, so it is **stopped while `document.hidden`** and
restarted on return. The map pans to the user only on an explicit request (and once on the first fix
after one). Following every fix would stop the user from ever looking elsewhere. A permission denial
ends the watch and resets it so the button can ask again.

### 9. The error boundary cannot fix what is stored (`ErrorBoundary.jsx`, `useFavourites.js`)

A render error used to leave a blank page. `ErrorBoundary` wraps `<App />` and shows a reload
button, in the saved language. A reload cannot escape a crash caused by **saved data**, though: that
data is read again on every launch. So `useFavourites` sanitises what it reads (non-arrays, entries
without string `city`/`code`, non-string names). Verified by planting a malformed entry: before the
fix the app crash-looped, after it the app loads. Apply the same rule to any new persisted state.

### 10. Map tiles are fetched with CORS (`crossOrigin` on `TileLayer`, `osm-tiles-v2`)

Observed bug (1.1.0): a phone showed **1.5 GB of site data** for this app. Leaflet loads tiles as
plain `<img>` elements, which fetch cross-origin in `no-cors` mode, so the service worker cached
**opaque** responses. To avoid leaking cross-origin sizes, Chrome counts every opaque response as
6–11 MB of quota, whatever its real size (measured: 5 tiles totalling 108 KB registered as 55 MB).
The 600-entry tile cache could therefore report ~6 GB, pushing the origin toward eviction.

- `crossOrigin` on the `TileLayer` makes tiles CORS requests. OSM answers with
  `access-control-allow-origin: *`, so responses are normal and counted at their real size.
- The tile cache accepts **status 200 only**, never 0, so an opaque tile is passed through rather
  than cached if this ever regresses. `purgeOnQuotaError` is the backstop.
- The cache was renamed `osm-tiles-v2`, and `main.jsx` deletes the old `osm-tiles` on every start.
  That line can go once no installed copy older than 1.2.0 is likely to be opened.

**Any replacement for `TILE_URL` must send CORS headers.** With `crossOrigin` set, a tile server that
does not will fail to load tiles at all, rather than silently caching them opaque. Check with
`curl -sI -H 'Origin: https://example.com' <tile url> | grep -i access-control`.

### 11. Stop taps have slack (`TAP_REACH_PX`, `clickTolerance`, `StopMap.jsx`)

Reported problem: stops were hard to select, for more than one person. Two causes, both fixed:

- A stop is a 10px circle, and Leaflet counts a canvas hit only inside it (plus a few px): a target
  under 12px for a fingertip. `TapNearestStop` handles taps that miss every circle and selects the
  nearest stop within `TAP_REACH_PX` (22px), which makes each stop a ~44px target without drawing it
  bigger. A tap inside a circle is handled by that stop; canvas hits do not reach the map's `click`.
  Bus markers are DOM markers with `bubblingMouseEvents: false`, so a tap on a bus never selects the
  stop beneath it.
- Leaflet turns a press into a map drag after 3px of movement, and a drag is never a tap — so a
  finger's wobble lost the tap and, because map drags collapse the sheet, hid the panel too.
  `L.Draggable.mergeOptions({ clickTolerance: 8 })` gives fingers room. It is a module-level default,
  so it applies to every draggable, which is intended.

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
- City names are the exception: citybus.gr publishes them only in Greek, so English names come from
  `CITY_NAMES_EN` in `i18n.js`, keyed by slug. Always render a city with `cityName(city, lang)`.
  A city the table does not know falls back to its title-cased slug, so a new city on the platform
  still shows a readable name — add it to the table when you notice one.

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
  i18n.js      el/en strings, English city names
  storage.js   localStorage guarded against private-mode throws
  main.jsx     mounts App inside ErrorBoundary
  components/  StopMap · StopSheet · HomePanel · SettingsSheet · ErrorBoundary · Icon (inline SVGs)
  hooks/       useStops · useLiveArrivals · useSchedule · useRouteShape · useGeolocation
               useSheetDrag · useFavourites · usePersistentState
```

## Verifying changes

Start the server (`cd server && npm run dev`), then:

```bash
curl -s localhost:3000/api/irakleio/stops | python3 -c "import json,sys;print(len(json.load(sys.stdin)))"
```

Expected results:

- `/api/cities` → 30 · `/api/irakleio/stops` → 547 · `/api/chania/stops` → 483 · `/api/patra/stops` → 847
- `/api/irakleio/stops?lang=en` → no stop with a null `name` (quirk 3)
- `/api/irakleio/stops/0122/live` → live vehicles (`0122` is a busy central stop, good for testing)
- `/api/irakleio/stops/9999/live` → `{"vehicles":[],"noService":true}`
- `/api/irakleio/stops/0122/schedule` → 8 departures with `time` ≥ the current Athens time
- `/api/irakleio/lines/06/routes/21009/shape` → 200, ~2.4 KB · an unknown route → 404
- `/api/nosuchcity/stops` → 404, not 502
- `/api/evil.com/stops` → 400, `/api/irakleio/stops/..%2f..%2fetc/live` → 400 (same for `/schedule`),
  `/api/irakleio/lines/..%2f06/routes/1/shape` → 400
- **Any-city check:** request a city never used before; it must work with no code change. That is the
  auto-discovery guarantee and it is easy to break.

Token refresh (the path that otherwise only fails in 48 hours): stop the server, corrupt the
signature of a token in `server/.cache/sites.json` while leaving its `exp` intact, restart, and
request live arrivals. It must return data — one refresh, one retry, no loop.

Front end: `cd web && npm run build`, then load `localhost:3000` at phone size and confirm:
- the map frames the city
- a stop opens with arrivals and lands in the visible band, not under the sheet
- buses appear as coloured markers and glide after each poll
- tapping an arrival collapses the sheet, draws the route and frames the bus and the stop
- the collapsed peek then leads with Back, which expands the list and returns the map to the stop
- dragging the map collapses the sheet, and the handle and header drag it both ways; collapsing and
  expanding animate rather than jump
- a tap ~15px beside a stop opens it; a tap far from any stop does nothing; a tap on a bus focuses it
- a stop with more than 3 live buses shows a closed timetable toggle and makes no `/schedule` request;
  one with 3 or fewer opens it; opening it at the bottom of a long list scrolls the first times into view
- the English city picker shows English names, sorted

Two traps for automated browsers: a page that is **not visible** gets no `requestAnimationFrame`, so
`flyTo` stalls on its first frame and a pending fit fires later, which looks like a pan bug and is
not. And geolocation is usually denied, so test the watch by replacing `navigator.geolocation` with a
fake before pressing locate.

## Releasing

The app is published as a Docker image: **`giorgospap777/citybus-pwa`**
(https://hub.docker.com/r/giorgospap777/citybus-pwa). `docker-compose.yml` pulls it rather than
building, so deploying is a pull, not a build on the target host.

To cut a release:

```bash
docker build -t giorgospap777/citybus-pwa:1.2.0 -t giorgospap777/citybus-pwa:latest .
docker push giorgospap777/citybus-pwa:1.2.0
docker push giorgospap777/citybus-pwa:latest
```

Always move both tags. Pushing only `latest` leaves no way to roll back a bad build.

Before pushing, run the image and check it end to end — the build succeeding proves very little
on its own:

```bash
docker run -d --name citybus-test -p 3200:3000 giorgospap777/citybus-pwa:1.2.0
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

- **Verified working:** home-screen install and the service worker, confirmed on a real device
  against the live instance at <https://bus.ginet.vip>. Note that service workers and geolocation
  need a secure context, so this only holds over HTTPS — a reverse proxy must force SSL, or users
  arriving over plain HTTP silently lose both.
- **Timetables show the next 8 departures only** (`/schedule`): alone when no bus is live, behind a
  toggle otherwise. A full day view is a small step from `getDayTimetable`.
- **The system back button is not handled.** In an installed PWA, Android's back gesture closes the
  app rather than leaving a focused bus or an open stop. Doing that means pushing history entries for
  those states and undoing them on `popstate`.
- **Route lines are built for the tapped bus only.** Showing every route through a stop, or a line
  browser, is additive — `/shape` and `/lines` already exist.
- **Not built, endpoint confirmed working:** `/routes/{route}/sequence` (a route's ordered stops),
  which would let a tapped bus show the stops it has left before this one.
- **HTTPS is required in production**, not cosmetic: PWA install and geolocation both need a secure
  context. `localhost` is exempt, so development needs nothing.
- **OSM tile policy:** the public tile servers ask that heavy apps not use them. `TILE_URL` is a
  constant in `StopMap.jsx` for exactly this reason. A replacement must send CORS headers — see
  load-bearing decision 10.
- This is an **unofficial** client of a public API. Treat the upstream as something to be gentle
  with; that is the reasoning behind the caching, and it should survive refactors.

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
because that list is scraped from citybus.gr. Once the server has asked for one's stops, it remembers
the city for a week, `/api/cities` marks it `noData`, and the picker greys it out (decision 20).
Until then, picking it shows the `cityUnavailable` string.

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
| `/api/v1/{lang}/{agency}/routes/{route}/sequence` | `[{sequence, code}]`: the stops a route calls at, in order. **Ask in `el`**: `en` is a 404 in Chania and Volos. A circular route lists its terminus first and last (18 of 30 Chania routes checked) | yes, via `/sequence` |
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
3. The English `/stops` feed has gaps. Some stops have **`name: null`** (Heraklion `2196` and `0822`
   as of 2026-09). Observed bug: the client's search called `.toLocaleLowerCase()` on one and the
   whole app went blank. Others are **missing altogether**: Larisa `0501`, and Serres `13043`,
   `12340`, `13021` and `13022` (2026-09-30). In English they vanished from the map and search, and a
   shared link to one closed at once. `repairEnglish` fills both from the Greek list: the Greek name
   (then the code) for a nameless stop, and each missing stop as it is in Greek. It runs *after* the
   cache read, so entries cached before the fix are repaired too.

An unknown city slug is also worth knowing about: `{slug}.citybus.gr` 302s to the landing page rather
than 404ing. `fetch` follows that silently, so `fetchSite` checks the final hostname and reports 404 —
otherwise it surfaces as a misleading "page layout may have changed" 502. A slug seldom gets that far
now: `index.js` refuses one that is not in the scraped city list (decision 15). That 404 is not the
API's own, so it stays an error. Only a 404 that `apiGet` marks `fromApi` is read as "no buses due",
"no trips that day" or "no data for the agency". Read as "no service", a link with a misspelt city
answered "no buses due".

---

## Our own API

Same-origin with the SPA in production; Vite proxies `/api` to port 3000 in development.

```
GET /api/health                             {ok:true}
GET /api/config                             {defaultCity, defaultLang}
GET /api/cities                             [{slug, name, agencyCode|null, noData, bounds|null}]
GET /api/:city/stops?lang=el                upstream stops, cached 24h
GET /api/:city/lines?lang=el                upstream lines, cached 24h
GET /api/:city/stops/:code/live?lang=el     {vehicles[], noService, fetchedAt}, cached 10s
GET /api/:city/stops/:code/schedule?lang=el {departures[], fetchedAt}, day timetables cached 12h
GET /api/:city/lines/:line/routes/:route/shape
                                            {lineCode, routeCode, points[[lat,lon]]}, cached 24h
GET /api/:city/routes/:route/sequence       {routeCode, stops[]}, stop codes in order, cached 24h
```

`/shape` is the street path of one route, drawn when the user taps a bus. The upstream serves a whole
line at once (86–530 KB), and the production host sits on a home connection with ~5 Mbit/s of upload,
so the server splits the line by route and simplifies each path (Douglas–Peucker, 4 m tolerance,
`SHAPE_TOLERANCE_M`): line `06` goes from 900 points / 86 KB to ~120 points / ~2.4 KB with no visible
difference at street zoom. Keep payloads in that range. It is sent `public, max-age=86400`, and the
service worker keeps shapes in their own `CacheFirst` cache (`citybus-shapes`), so a route is
downloaded once a week per device, not once per tap.

`/schedule` returns the next 8 timetabled departures from now, rolling into the following days when
today runs out, up to the same weekday next week. Each has `time` (`"HH:MM"`), `departsAt` (epoch
ms, so the client can drop departures as they pass without refetching; see decision 16 for how it is
computed), `daysAhead` (0 today, 1 tomorrow, …), `tomorrow` (kept for clients from before
`daysAhead`), and the line fields. The client labels a later day by its weekday. Reading only today
and tomorrow said "no more departures" on a Saturday evening at a stop whose lines skip Sunday. Days
past tomorrow are fetched only for a stop that today and tomorrow cannot fill, all at once. It answers "when is the next bus?" where
live data (30 minutes ahead) cannot, so it is **always shown when live arrivals are empty**. Beside live
buses it sits behind a one-line toggle, open by default at a stop with 3 or fewer live buses
(`useTimetableShown`), and is requested only while shown, so opening a busy stop costs nothing extra.
Like `/live` it is `no-store`, and the service worker treats it as `NetworkOnly`: a cached "next departures"
list lists buses long gone.

Errors are JSON `{error}`. Our own `HttpError` messages go to the client as written. Any other error
gets a generic message, and it keeps its status when Express gave it a 4xx (a `%FF` in a path is a
400, not a 500). Only 5xx errors are logged: one line for an upstream failure, and a full stack trace
only for our own bugs. In an outage every poll lands in that log. Refusals by the upstream budget
are the exception: `citybus.js` counts them and logs once a minute (decision 15). The SPA fallback answers `GET` and
`HEAD`, and it passes over any path with a file extension. Those get a real 404: a page left open
across a deploy asks for its old hashed bundle, and handing it `index.html` failed as a script, a
blank screen.

The city list is scraped from the citybus.gr landing page and kept a week. A failed scrape serves the
last good list (kept a year for this), or the seed list on a cold start, and is tried again after 10
minutes. It used to be cached like a good one: a server started during a citybus.gr blip showed
Latin slugs as city names, in Latin order, for a week, across restarts.

`agencyCode` in `/api/cities` is `null` until that city has actually been used. Resolving all 30
eagerly would mean 30 extra page fetches for a field the UI does not need. `noData` is learned the
same way (decision 20). `bounds` is the area a city's stops cover, `[south, west, north, east]`, from
`CITY_BOUNDS` in `cities.js` (decision 20).

`/sequence` is one route's stops in order, as codes: ~0.4 KB. It is sent `public, max-age=86400`
and shares the service worker's `citybus-shapes` cache with `/shape` (160 entries, two per route
followed). It is always fetched in Greek; the codes are the same in both languages.

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

The live cache is deliberately **memory-only** (no `dir`) — the static caches persist to disk, but
writing a file every 10 seconds would be silly. Failures collapse the same way; see decision 15.

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

`inFlight` is only as good as the request under it. Observed: one request that never settled (what a
phone gets on a dead cell handover or captive Wi-Fi) left `inFlight` set, and polling, Refresh and
resume all stopped for good. `api.js` now gives every request a timeout: 12 s for live arrivals and
timetables, 20 s for the stop list, 15 s otherwise. It rejects as `TimeoutError`, **never
`AbortError`**, which every hook ignores as the sign of its own cleanup; a timeout dressed as one
would hang exactly as before. Verified: a hung poll shows "not responding" at 12 s, and the next
poll 15 s later recovers.

Verified: pure polling is 2 requests per 33 seconds. Keep it that way.

One exception to stopping while hidden: `whileHidden`, set only while an arrival alert watches that
stop (decision 18). The user has put the phone away precisely to be told. It ends when the alert
fires or is dropped, at most the 30 minutes live data reaches ahead. Verified: with the page hidden,
3 polls in 45 s, then none once the alert was dropped. It is read through a ref at each tick, so
setting it does not restart the poll.

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
- The peek never says more than it knows. With live data failing before any arrived it said "no
  buses in the next 30 minutes", the answer that sends someone walking; it now gives the error.
  Chips from an old answer (a failed poll, or none for 45 s) are dimmed behind a ⚠ and what is
  wrong: the failure in a word, or the age. They used to count frozen minutes as if live. The note
  sits in the same row, so the peek stays one line and `getBottomInset` is unaffected.

### 7. Moving buses and the map's render cost (`StopMap.jsx`)

- `GlidingMarker` hands react-leaflet only the **first** position (`useState(position)`) and animates
  later ones itself over `GLIDE_MS`. react-leaflet calls `setLatLng` whenever `position` changes
  identity, which cuts every glide short. Jumps over `MAX_GLIDE_M` (a new trip or a GPS glitch) and
  `prefers-reduced-motion` skip the animation.
- Stop markers are memoised on `[stops, selectedCode, onSelectStop, routeCode, routeColor, onRoute,
  passed]`. Otherwise
  each 15s poll handed all ~550 `CircleMarker`s a new `pathOptions` object, and react-leaflet
  restyled every one — a full canvas redraw per poll. `onSelectStop` must stay a stable callback for this to hold.
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

`usePersistentState` takes a sanitiser for this, applied on read. The saved city and language pass
`asCity` (the server's slug rule) and `asLang`, and anything else reads as "not chosen", so the
server's default applies. Observed: a saved city of `123` crashed rendering the city's name, and the
error screen's reload crashed again.

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

### 12. The system back button (`web/src/hooks/useBackButton.js`)

A single-page app has no history of its own, so in an installed PWA Android's back gesture closed the
app from anywhere: an open stop, a followed bus, the settings sheet. Back now steps out of those one
at a time and leaves the app only from the home panel.

- One history entry per open layer (settings, a followed bus, a stop), with state
  `{citybusLayer: n}`. `App.jsx` counts the layers and closes them topmost first (`closeLayersTo`).
- Entries are pushed **when a layer opens**, from the tap that opened it, never in response to
  `popstate`. Chrome's back button skips an entry that pushed another without a user gesture in
  between. Observed: one guard entry re-pushed after each pop made the second back press find no
  history, and in an installed app that closes it.
- A layer closed in the UI (✕, the Back chip, picking a city) pops its entries with `history.go()`.
  Left in place, they would make the next back presses do nothing.
- `popstate` closes layers only when it lands **below** the open depth; a pop the app made itself
  lands exactly on it. This is a comparison rather than an "ignore the next pop" flag. Picking a city
  while following a bus closes three layers over two renders, which is two pops (observed), and a
  flag left set by a pop that never arrived would swallow the user's next back.
- A reload lands on the current entry, layer count and all, but without the layers. Android reloads
  an installed app whenever it restores one it discarded in the background. So the module rewinds to
  the base entry at load. Relabelling the stale entry instead was tried: the first back after a
  reload then did nothing visible. The rewind runs at module level, once per load. In an effect,
  StrictMode would run it twice in development, and the second rewind would leave the app.
- Stops stack. Reported: a stop opened from the map while another was open replaced it, so back went
  home instead of to the stop before. `App.jsx` keeps a `stopTrail` (the open stop is its last entry),
  one layer per stop, capped at `MAX_STOP_TRAIL` (5). Back is also how an installed app is left, and
  a dozen presses to get out is worse than losing a stop from five ago. A stop already in the trail
  moves to the top rather than appearing twice. ✕ leaves every stop at once. Opening a stop while
  following a bus replaces the bus layer, so the depth, and the history, stay the same.
- A stop opened from a shared link (decision 17) is **not a layer**. No tap opened it, so an entry
  pushed for it would be one Chrome skips. It is marked `fromLink` in the trail, and `linkBase`
  takes it out of the count. Back from it leaves, as back from any linked page does; stops opened
  from it stack as usual. Verified: link stop, then a stop from the map, then back: the linked stop
  returns, with the history back at its base entry. When the trail is cut to 5 and the linked stop
  drops off, the count rises by one as a new stop is added, so the history still matches.

### 13. The followed bus's stops (`routeCode` in `StopMap.jsx`)

Asked for: while a bus is followed, show only the stops it will call at. Those stops are drawn as
rings in the line's colour, and every other stop fades to near-invisible (`OFF_ROUTE_STOP`). They
fade rather than vanish so a tap, with its slack (decision 11), still reaches them.

- Membership comes from the route's own stop order (`/sequence`, `useRouteSequence`) once it has
  loaded, and from `routeCodes[]` on each stop until then or if it fails. The two agreed on all 60
  Heraklion routes and 60 routes in Chania and Volos checked. `routeCodes[]` was checked against the
  drawn paths of five Heraklion routes: every stop listed for a route lay within ~20 m of it.
- Stops the bus has **already left** are drawn smaller and faded in the line colour (`PASSED_STOP`).
  `routeProgress` in `geo.js` places the bus on the stretch between two consecutive stops it lies
  closest to, looking only at stretches before the user's stop, since the stop lists the bus because
  it is coming. That also settles a circular route, whose terminus is behind the bus and ahead of it
  at once: ahead wins. A bus over 300 m from every stretch (leaving the depot, or a bad fix) gets no
  progress. The same result gives "N stops away" in the peek chip and the followed row: the stops
  the bus still calls at **before** the user's, which is not counted ("your stop is next" at 0).
  Reported: with one stop between the bus and the user, "2 stops away" read as wrong. The followed
  bus's chip leads the peek, after Back; in its place by arrival time the count was cut off at the
  edge. Only for buses with a GPS fix. Verified against live buses: counts matched the map. One bus reported
  3 minutes while standing at the airport terminus 24 stops away; the count shows the ETA was wrong.
- The markers are memoised on the passed index, a number, so they restyle when the bus passes a stop,
  not on every poll.
- A followed bus that leaves the list is let go by itself after **two** answers without it (the feed
  drops a bus for a single answer now and then), with a message: "has passed this stop" if it was
  last seen a minute out, "no longer listed" otherwise. Its route used to stay drawn, with nothing
  saying it had gone. The focus is a layer, so its history entry is popped like any closed layer;
  the map and the sheet stay put. Verified: history back from layer 2 to 1, route gone.
- **Every stop style sets `opacity` explicitly.** Leaflet's `setStyle` merges into the old options, so a
  style without it would inherit the faded one's 0.25. Observed shape of the bug: stops staying faded
  after the bus is let go.

### 14. Recovering without a reload (`useStops`, `useLiveArrivals`, `useSchedule`)

An installed app has no reload button, so each of these used to be a dead end until the app was
killed.

- **A failed stop list retries.** It retries with backoff (5 s doubling to 60 s), and at once on
  `online` or on return to the app. A 404 is a city without data (`trikala`) and is not retried.
  While the list is missing, the home panel still shows favourites: a favourite carries its code and
  name, which is all live arrivals need. A retry keeps the failure, the button (reading "loading")
  and the favourites on screen; it used to replace them with "Loading stops…" at every attempt. The retry effect is keyed on the **error object**, a new
  one per failure. Observed: keyed on a boolean, it stopped after one retry when the failure came
  back at once. React batched "loading" and "failed" into one render, so the boolean never changed.
- **Refresh is one more poll, not a restart.** Observed: restarting the poll effect emptied the
  list, brought back the spinner and shrank the sheet by 330px before it regrew. With the network
  down, it replaced good arrivals with an error. `refresh()` now calls `cycle()` through a ref and
  obeys `MIN_REFRESH_GAP_MS` like a resume does. It refreshes the timetable too.
- **The timetable refetches as it runs down.** Eight departures from a busy stop cover ~20 minutes.
  Fetched once, the list emptied while the stop stayed open, and it then read as "no more
  departures". `useSchedule` refetches once only `REFILL_AT` (3) departures are left to come, or on
  return to the app once that point has passed. It waits at least `MIN_REFETCH_MS` and at most
  `MAX_AGE_MS`. Those are timed from **this device's clock** at receipt, not the server's
  `fetchedAt`: a phone whose clock runs fast would otherwise find every fresh list overdue and
  refetch in a loop.
- **A failed timetable fetch keeps its list and retries.** Observed: one failure replaced the list
  with the error, the only useful thing on screen while live data was failing too, and nothing
  fetched it again after the network returned. `useSchedule` now keeps the data beside the error and
  retries 15 s doubling to 2 min, and at once on `online` or on return. The error shows only when
  there is no list.
- **Live failing still offers the timetable.** Failed live arrivals count as 0 buses for the timetable's
  default, and the timetable shows under the error.
- **"Updated … ago" is timed from receipt on this device** (`receivedAt`), in minutes past 60 s. From
  the server's `fetchedAt` it said "120 s ago" right after a poll on a phone two minutes fast, and
  "1834 s ago" after a stall.
- Errors are worded for people: `errorMessage` in `i18n.js` says "offline" or "not responding"
  in the UI's language, never the raw English message.

### 15. Server caches are bounded, failures are cached, upstream calls are budgeted

- **Bounded.** `TtlCache` sweeps expired entries every minute and caps entries per cache (`maxEntries`,
  oldest write evicted). Before, an entry was dropped only when its own key was read again. Stop codes
  are user input, so a caller cycling codes grew the heap without limit. `docker-compose.yml` sets
  `mem_limit: 256m` as a backstop.
- **Failures are cached** (`failureTtl` in `citybus.js`): a 404 for 10 minutes, anything else for 5
  seconds. Measured before: an unknown city was fetched from `{slug}.citybus.gr` on every request, and
  in an upstream outage every poll from every user went upstream. The single-flight of decision 1 failed
  exactly when it mattered. Failures stay in memory and are never persisted. `delete()` clears them,
  which the token refresh relies on.
- **Upstream budget.** A token bucket in `citybus.js` (`UPSTREAM_PER_SECOND` 10, `UPSTREAM_BURST` 50)
  covers every call to citybus.gr, the post-refresh retry included. When it is empty, the request gets
  a 503. Normal use stays far below it because of the caches. It exists so that nobody can use the
  proxy to hammer the upstream, since it is this server's address that would be blocked. It is
  **global, not per client**, on purpose: behind the reverse proxy and mobile carrier NAT one address
  can be many people, and what it protects is the upstream, which is the same whoever asks. If real
  use ever meets it (it allows ~100 stops watched at once), raise the rate. Do not switch to per-IP.
- **Made-up names cost nothing.** Measured with a stubbed upstream: a flood of made-up stop codes
  (15/s, each a cache miss) spent the budget, and 7 of 8 real polls got 503. Now `index.js` refuses a
  city not in the scraped list (`isKnownCity`), and `knownCodes` checks stop, line and route codes
  against the city's Greek stop list before asking the upstream. An unknown stop answers what the
  upstream would (`noService`, an empty timetable), an unknown route 404s. Verified: 200 made-up
  codes, no upstream call. The cost is that a stop or route added upstream is unknown until the stop
  list refreshes (24 h); checked, all 151 live buses at 20 stops in 5 cities had codes in the list.
  A second budget reserved for keys that answered recently was considered and not built: with
  made-up codes free, what is left is cycling real codes, and those become "known" after one answer.
- **Refusals are logged once a minute, with a count**, not once per request. A line each brought back
  the log flood the `%FF` fix closed (measured: ~105 lines in 30 s). The error carries `logged` so
  `index.js` stays quiet.
- **The budget runs on a monotonic clock** (`performance.now`). On `Date.now`, a wall clock stepped
  back (an NTP correction) drove the budget negative and refused everything for as long as the step.
  Found when a test faked the clock.
- **Payloads are checked before they are cached** (`expectArray`). Measured with a stub answering 200
  `{"message":"maintenance"}`: the object was cached as Heraklion's stop list for 24 h, on disk, so a
  restart kept it, and every other endpoint 500ed with a stack trace per request. Now each is a 502,
  cached for 5 s and never persisted. An empty stop list is refused too; a city without data is a
  404, not `[]`.
- A token refresh logs one line (`[citybus] <city>: token rejected, fetching a new one`). It is the
  path that otherwise shows itself only every 48 hours.

### 16. Timetable instants are computed per date (`serviceClock`, `serviceInstant`, `citybus.js`)

Trip times are Greek wall-clock times. `departsAt` used to be "now plus the minutes until the trip".
That assumes every day has 24 hours. On the Saturday before summer time ends (Sun 25 Oct 2026, 04:00 →
03:00), Sunday's departures came out an hour early, and the client dropped each one an hour before it
left. `serviceInstant(date, minute)` now finds the UTC instant of that wall-clock time on that date,
using the offset in force then. Verified: Sat 24 Oct 21:00 → Sun 07:00 is `2026-10-25T05:00Z`.

`serviceClock` reads **numeric** date parts in `Europe/Athens` and derives the weekday with
`Date.UTC(...).getUTCDay()`. It used to match `en-GB` weekday names. Locales have changed
abbreviations before ("Sep" → "Sept"), and a mismatch gave day `-1` and a failing `/schedule`
everywhere.

### 17. Shared stop links (`link.js`, `App.jsx`)

`/?city=irakleio&stop=0122` opens the app on that stop. The share button in a stop's header uses the
system share sheet where there is one (phones) and the clipboard otherwise.

- The link is read **once, at module level**, before the first render, so the stop is open from the
  start. The query is then removed from the address bar. Left there, every reload would reopen the
  linked stop, and Android reloads an installed app whenever it restores one from the background.
- Both values pass the server's own patterns (`validate.js`). Anything else is ignored.
- The link's city is shown at once and saved as if picked in settings once its stops load: a stop
  shared from a city is almost always for someone in it. Saved at once, a misspelt link
  (`city=irakleo`) replaced the user's city with one that does not exist. A link city whose stops
  404 (unknown, or without data) is dropped with a message, and the saved city returns. Until it is
  confirmed it lives in `linkCity`, and picking a city anywhere (`chooseCity`) clears it.
- The linked stop starts with only its code, so live arrivals start at once. The name and position
  arrive with the stop list, and the map then pans to it. A code the city does not have closes the
  stop.
- The city-change effect skips the first render (`shownCity`). Run on mount as well, it would close
  the linked stop as soon as it opened.
- Back from a linked stop: see decision 12.

### 18. Arrival alerts (`useArrivalAlert.js`)

Asked for: "tell me when it's close". A bell beside each live bus sets an alert for when that bus is
the chosen number of minutes away (settings: 2, 5 or 10; default 5). There is no push server, so it
works only while the app runs.

- One alert at a time. It fires once (vibration, a notification, and a message in the app) and clears
  itself. A bus already inside the lead time is announced as it arrives (1 minute) instead. The bell
  is hidden for a bus a minute out, where an alert could only come too late.
- The alert keeps **its own stop** polled, open or not, so the user can look at other stops while
  waiting. When that stop is open, its own poll is used rather than a second one. An alert bar at the
  top of the sheet shows it from anywhere else, and a tap reopens the stop.
- It polls while the app is hidden (decision 2). A bus missing from 3 answers in a row cancels the
  alert with a message. One is not enough: the feed drops a bus now and then.
- Notifications go through the service worker (`registration.showNotification`). Android Chrome
  throws on `new Notification()`, which is kept for the development server, which has no worker.
  `public/sw-alerts.js`, pulled in by `workbox.importScripts`, focuses the app when the notification
  is tapped; without it, tapping did nothing.
- Its outcome waits to be seen. Observed: fired in the background with notifications refused, the
  alert left nothing on screen on return, since its message had timed out unseen. A message's time
  on screen now starts only while the app is in view, and one produced while hidden starts with the
  time it happened ("19:12 · …"): "3 minutes away" read ten minutes later is wrong without it. A
  cancelled alert ("no longer listed") notifies too, when allowed.
- Permission is asked on the first bell tap, the gesture the prompt needs. Denied, the alert still
  works in the app, and the confirmation says "while the app is open".
- The alert stores a plain copy of the stop, without the `fromLink` mark. With the mark, a linked
  stop reopened from the alert bar would take no history entry, and back would leave the app instead
  of going home. Found in review before release; verified fixed: reopened from the bar, the stop
  takes history entry 1.

### 19. Greeklish search (`search.js`)

Many people type Greek on a Latin keyboard, and `panepistimio` found nothing. Each stop name is also
reduced to how it sounds (`soundOf`): Greek letters to Latin as Greeklish spells them, then spellings
of the same sound collapsed to one letter (ξ and χ to x, β and μπ to v, ι η υ ει οι to i, doubled
letters to one). Both sides are reduced the same way, so conflating two sounds loosens the search a
little and never breaks a match.

- Latin **h** is ambiguous: χ in phonetic Greeklish (`hania`), η in the kind that copies the letters'
  look (`panepisthmio`). A query therefore has two readings (`soundsOfQuery`) and matches if either
  does. The visual one also takes u for υ; both take 8 for θ.
- Matches as typed come first; sound matches only fill the 25 results after them.
- Then words, in any order, each allowed a different ending (`stemsOfQuery`): every query word must
  start some word of the name, and one of 5 or more letters may differ in its last two. Names are
  mostly genitive (ΑΓΙΟΥ ΝΙΚΟΛΑΟΥ, ΧΑΝΙΩΝ, ΚΟΥΝΟΥΠΙΔΙΑΝΩΝ) while people type the nominative, and
  `agios nikolaos`, `hania` and `eleftherias plateia` found nothing. Last of three tiers, so it only
  fills what the closer matches leave.
- Digits are never collapsed: `1866` stays `1866`.
- No lookbehind in the patterns: Safari before 16.4 fails to parse the whole bundle on one.

### 20. Cities the user is not in, and cities without data

- Reported: Chania chosen, the user in Athens, and "Near me" listed stops 272 km away. When the
  nearest stop is over 20 km away (`FAR_FROM_CITY_M`), "Near me" says how far instead, and offers the
  city whose stop area is within 10 km of the user, if any (`nearestCity`).
- The areas are `CITY_BOUNDS` in `server/src/cities.js`, measured from the stop lists of 2026-09-30.
  Fetching 28 stop lists to find the nearest city was not an option on a home uplink. A city missing
  from the table is never suggested; add it when you notice one.
- A city whose site answers but whose stops are a 404 is remembered for a week (`noDataCache`,
  persisted), and `/api/cities` marks it `noData`. The picker greys it out, unless it is the current
  city. An unknown city 404s at its site, before it has an agency code, so it is never marked. A week,
  so a city the operator fills in is tried again.

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
  citybus.js   ALL upstream contact: token + agency discovery, validation, normalisation,
               the upstream budget, Greek service time
  cities.js    scrapes the citybus.gr landing page for the city list (seed list as fallback)
  cache.js     TTL cache: single-flight, failure caching, size caps, optional disk persistence
web/src/
  App.jsx      state orchestration; owns city/lang/stopTrail/focus/alert/panTarget/sheet mode
  api.js       fetch wrappers over /api, each with a timeout (decision 2)
  geo.js       distances, nearest stops and city, where a bus is along its route
  search.js    folding for search, and how a name sounds (Greeklish)
  link.js      shared stop links: reading one, making one
  validate.js  the server's patterns, for anything from storage or a link
  i18n.js      el/en strings, English city names, errorMessage
  storage.js   localStorage guarded against private-mode throws
  main.jsx     mounts App inside ErrorBoundary
  components/  StopMap · StopSheet · HomePanel · SettingsSheet · ErrorBoundary · Icon (inline SVGs)
  hooks/       useStops · useLiveArrivals · useSchedule · useRouteShape · useRouteSequence
               useArrivalAlert · useGeolocation · useSheetDrag · useFavourites
               usePersistentState · useBackButton
web/public/sw-alerts.js focuses the app when an alert's notification is tapped; loaded into the
                        generated service worker by workbox.importScripts
web/icon-maskable.svg   source of public/icon-maskable-512.png: full-bleed, bus inside the central
                        80% safe zone. Kept out of public/ so it is not precached. Re-render with
                        rsvg-convert -w 512 -h 512 icon-maskable.svg -o public/icon-maskable-512.png
```

## Verifying changes

Start the server (`cd server && npm run dev`), then:

```bash
curl -s localhost:3000/api/irakleio/stops | python3 -c "import json,sys;print(len(json.load(sys.stdin)))"
```

Expected results:

- `/api/cities` → 30 · `/api/irakleio/stops` → 547 · `/api/chania/stops` → 483 · `/api/patra/stops` → 847
- `/api/irakleio/stops?lang=en` → no stop with a null `name` (quirk 3) · `/api/serres/stops?lang=en` →
  as many as in Greek (398 until the operator removed the four stops English lacked, 2026-09-30: 394)
- `/api/irakleio/stops/0122/live` → live vehicles (`0122` is a busy central stop, good for testing)
- `/api/irakleio/stops/9999/live` → `{"vehicles":[],"noService":true}`, answered from the stop list
  without an upstream call · `/api/irakleo/stops/0122/live` (no such city) → 404, not `noService`
- `/api/irakleio/stops/0122/schedule` → 8 departures with `time` ≥ the current Athens time, each
  with `daysAhead`
- `/api/irakleio/lines/06/routes/21009/shape` → 200, ~2.4 KB · an unknown route → 404
- `/api/irakleio/routes/21009/sequence` → 45 codes, `9911` first · `/api/chania/routes/067/sequence` →
  starts and ends with `74005` · `/api/irakleio/routes/99999/sequence` → 404 ·
  `/api/irakleio/routes/..%2f1/sequence` → 400
- after `/api/trikala/stops` (404), `/api/cities` marks `trikala` `noData: true`, and
  `/api/nosuchcity/stops` marks nothing
- `/api/nosuchcity/stops` → 404, not 502, without an upstream request (not in the city list)
- `/api/evil.com/stops` → 400, `/api/irakleio/stops/..%2f..%2fetc/live` → 400 (same for `/schedule`),
  `/api/irakleio/lines/..%2f06/routes/1/shape` → 400
- `/api/irakleio/stops/%FF/live` → 400 `{"error":"Bad request"}`, and nothing in the log
- `/assets/index-doesnotexist.js` → 404 · `curl -I /some/route` → 200, like `GET`
- **Any-city check:** request a city never used before; it must work with no code change. That is the
  auto-discovery guarantee and it is easy to break.

Token refresh (the path that otherwise only fails in 48 hours): stop the server, corrupt the
signature of a token in `server/.cache/sites.json` while leaving its `exp` intact, restart, and
request live arrivals. It must return data — one refresh, one retry, no loop — and log one
`token rejected` line.

Cache bounds, failure caching and the upstream budget are best checked against a stub, not the live
API: import `TtlCache` in a scratch script, write 10 000 keys and confirm the size stays at
`maxEntries`, and check that concurrent failing `wrap` calls share one producer call. With
`globalThis.fetch` replaced before importing `citybus.js` and `CACHE_DIR` pointed at a scratch
directory:
- an upstream answering 200 `{"message":"maintenance"}` gives 502 from stops, lines, live, schedule,
  shape and sequence, `static.json` stays empty, and the upstream is asked again after 5 s
- with a stop list cached, 200 made-up stop codes make no upstream call
- a stop with trips only on Monday, asked at Saturday 23:30 Athens (fake `Date.now`), lists Monday's
  trips with `daysAhead` 2
- a flood past the budget logs one `upstream budget spent` line
- a landing page that fails serves the last good city list; on a cold start, the seed list, and the
  scrape is not retried for 10 minutes

Note that 60 *concurrent* requests for new cities are all refused, in 1.4.0 as well: their site
fetches spend the whole burst, leaving nothing for the API calls after them. That is the bucket
working, not a bug in a test. For timetable
instants, `serviceInstant({year: 2026, month: 10, day: 25}, 7 * 60)` must be `2026-10-25T05:00:00Z`.

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
- back steps out one layer at a time (settings, then a followed bus, then the stop) and then leaves;
  after closing a layer with ✕ or the Back chip, the next back still does something
- after a reload with a stop open, a single back leaves the app
- open a stop, tap another on the map, press back: the first stop returns, then home
- following a bus rings its route's stops in the line colour and fades the rest; back restores them all
- Refresh keeps the list on screen (no spinner, no shrinking sheet)
- a saved city of `123` in `localStorage` loads the default city instead of the error screen
- with `/stops` failing (override `fetch` and switch city), the home panel shows a translated error, a
  retry button and the favourites, retries after 5 s then 10 s, and recovers
- with `/live` failing, a stop shows the translated error and the timetable below it
- at 1280 px wide the sheet is 480 px and centred
- `/?city=irakleio&stop=0122` with another city saved: the stop opens in Heraklion, the address bar
  shows `/`, and `history.state` is null. Open a stop from the map, then back: the linked stop returns.
  `stop=ZZZZ` closes to home once the stops load; `city=evil.com` is ignored
- following a bus shows "N stops away" in its chip, first after Back, where N is the ringed stops
  between the bus and the selected one, and fades the stops behind it; the counts add up (passed +
  ahead + the selected stop = the route's length)
- a stop's arrival rows are ~52 px tall (two lines each): 58 was reported as wasted space, 46 as
  cramped
- a bell sets an alert (a message confirms, the bell shows the minutes); with `/live` faked to bring
  that bus inside the lead, the next poll vibrates, notifies (through the service worker) and says
  so. Closed stop: an alert bar shows the minutes and reopens the stop. With `document.hidden` faked,
  polling continues; faked missing for 3 polls, the alert cancels with a message and polling stops
- `panepistimio` and `panepisthmio` find ΠΑΝΕΠΙΣΤΗΜΙΟ
- a fake fix in Chania with Heraklion chosen: "Near me" gives the distance and offers Chania
- settings greys out a city the server has found without data
- a `fetch` wrapper that never settles `/live`: "not responding" within ~12 s, the next poll 15 s
  later recovers. One that never settles `/stops` after switching to a city with a favourite: at 20 s
  the error, the retry button and the favourite; the retry 5 s later keeps all three on screen
- `/live` failing (`TypeError`) before any answer, sheet collapsed: the peek gives the error, not
  "no buses". After an answer: dimmed chips behind "⚠ offline". Hidden for over a minute: "⚠ 1 min ago",
  and "Updated 1 min ago" in the expanded footer
- `/schedule` failing on a refetch: the list stays; it refetches 15 s later, or at once on `online`
- an alert that fires with `document.hidden` faked: the message waits until visible, starts with the
  time, then clears 10 s later
- `/?city=irakleo&stop=0122` with Chania saved: Chania stays saved, and a message says the link's
  city is not available
- Share with `navigator.share` removed and the clipboard refused: a panel with the link selected;
  Copy closes it once the clipboard works
- a followed bus filtered out of two answers: let go with a message, history back one entry
- `agios nikolaos` (Heraklion), `hania` and `kounoupidiana` (Chania), `eleftherias plateia` find
  their stops; `panepistimio` still has ΠΑΝΕΠΙΣΤΗΜΙΟ ΚΡΗΤΗΣ in the top results

Traps for automated browsers:
- A page that is **not visible** gets no `requestAnimationFrame`, so `flyTo` stalls on its first
  frame and a pending fit fires later. That looks like a pan bug and is not.
- Geolocation is usually denied, so test the watch by replacing `navigator.geolocation` with a fake
  before pressing locate.
- A browser that has loaded the app before keeps its service worker, which serves **the old build's
  bundle**. Unregister it and clear the caches, then open a new tab.
- Test the back button by navigating back in the browser, not by calling `history.back()`. The
  browser's own back applies Chrome's entry-skipping rule, which is the thing under test; a script
  call may not.

## Releasing

The app is published as a Docker image: **`giorgospap777/citybus-pwa`**
(https://hub.docker.com/r/giorgospap777/citybus-pwa). `docker-compose.yml` pulls it rather than
building, so deploying is a pull, not a build on the target host.

To cut a release:

```bash
docker build -t giorgospap777/citybus-pwa:1.4.1 -t giorgospap777/citybus-pwa:latest .
docker push giorgospap777/citybus-pwa:1.4.1
docker push giorgospap777/citybus-pwa:latest
```

Always move both tags. Pushing only `latest` leaves no way to roll back a bad build.

Before pushing, run the image and check it end to end — the build succeeding proves very little
on its own:

```bash
docker run -d --name citybus-test -p 3200:3000 giorgospap777/citybus-pwa:1.4.1
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
- **The back button is verified in desktop Chromium only**, using the browser's own back, not yet
  with the gesture in an installed app on a phone. Back returns through up to 5 stops (decision 12).
  Forward, on desktop, reopens nothing.
- **Route lines are built for the tapped bus only.** Showing every route through a stop, or a line
  browser, is additive — `/shape` and `/lines` already exist.
- **Arrival alerts need the app running** (decision 18): there is no push server. In the background
  the browser may slow the poll to once a minute, or stop the page altogether, and an alert then
  comes late or not at all. Real push would need a server-side watcher and Web Push keys. Not tested
  on a phone yet, nor on iOS, where notifications need the app installed (16.4+).
- **"N stops away" needs a GPS fix**, so about half of live buses get none.
- **Share and links not tested on a phone.** Whether an installed app captures a shared link or it
  opens in the browser is up to the phone.
- **Unchecked: trips just after midnight.** Day timetables list trips at 00:00–01:02, which the
  server treats as the early morning of that calendar day. If the operator means the end of the
  previous service day, `/schedule` shows the wrong set around midnight. Compare `/schedule` with live
  arrivals and the operator's own site at ~23:45 on a weekday before changing anything.
- **No per-client rate limit, by design** — see decision 15 for the global upstream budget instead.
- **Wide screens** keep the bottom sheet, capped at 480 px and centred. Docking it to the side would
  need the map insets (decision 5) to become side insets.
- **HTTPS is required in production**, not cosmetic: PWA install and geolocation both need a secure
  context. `localhost` is exempt, so development needs nothing.
- **OSM tile policy:** the public tile servers ask that heavy apps not use them. `TILE_URL` is a
  constant in `StopMap.jsx` for exactly this reason. A replacement must send CORS headers — see
  load-bearing decision 10.
- This is an **unofficial** client of a public API. Treat the upstream as something to be gentle
  with; that is the reasoning behind the caching, and it should survive refactors.

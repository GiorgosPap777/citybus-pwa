# Λεωφορεία — Citybus PWA

An installable web app for the **citybus.gr** live bus network. Pick your stop from a map, see how
many minutes until each bus arrives, and watch the approaching buses move in real time.

Opens on **Heraklion** by default. **28 of the 30 cities** on the platform work with no
configuration — the app discovers each one by itself.

> Unofficial community app. It reads the same public API the official site uses.

## Features

- **Map of every stop** in the city, tap one to open it.
- **Live arrivals** — line, destination and minutes, refreshed every 15 seconds.
- **Buses on the map**, coloured by line, moving as they approach.
- **Near me** — sorts stops by distance using your phone's GPS.
- **Favourites** — save your home and work stops; they open first, no map needed.
- **Greek and English**, including translated stop and line names.
- **Installable** — add to your home screen and it runs like a native app.

## Quick start

Two terminals. The API server:

```bash
cd server && npm install && npm run dev
```

The front end, which proxies `/api` to it:

```bash
cd web && npm install && npm run dev
```

Then open the URL Vite prints.

For a production-style run, build the front end once and let the server host everything on one port:

```bash
cd web && npm run build && cd ../server && npm start
```

That serves the whole app on `http://localhost:3000`.

**Requires Node 20.12 or newer** (native `fetch`, `--env-file-if-exists`).

## Why there is a server

`rest.citybus.gr` sends CORS headers only for its own origin:

```
access-control-allow-origin: https://irakleio.citybus.gr
vary: Origin
```

Any other origin gets no CORS headers at all, so **a browser cannot call the API directly** from a
domain you control. (`curl` works because curl ignores CORS.) The Node app in `server/` is a thin
proxy that also:

- scrapes each city's bearer token and agency code from that city's own page,
- refreshes the token automatically when it expires — they last 48 hours,
- caches stops and lines for 24 hours, and live arrivals for 10 seconds.

That last one matters. The 10-second cache means twenty people watching the same stop produce one
upstream request per 10 seconds instead of twenty. If you fork this, please keep it.

## Configuration

Copy `server/.env.example` to `server/.env`. Everything is optional:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DEFAULT_CITY` | `irakleio` | City the app opens on — any citybus.gr subdomain slug |
| `DEFAULT_LANG` | `el` | `el` or `en` |
| `CACHE_DIR` | `.cache` | Where stop and line caches persist between restarts |

`DEFAULT_CITY` only sets the starting point. Users pick their own city and language in the app's
settings, stored per browser.

Valid slugs are the citybus.gr subdomains — `irakleio`, `chania`, `patra`, `volos`, `larisa`,
`corfu`, `ioannina`, and so on. The app discovers each city's agency code by itself.

Two of the 30, **`trikala` and `yper-xanthi`**, have a citybus.gr site but no data in the API —
`/stops` and `/lines` both return 404 for their agency codes. They still appear in the city picker
(the list is scraped from citybus.gr) and show a "this city does not publish stop data" message if
selected. It is an upstream gap, not something this app can fix.

## Deploying

Runs as a single container. On a server that already has **Nginx Proxy Manager** in front of it:

```bash
docker compose up -d --build
```

Then add a proxy host pointing at port `3000` and request a certificate. Full walkthrough, including
the exact NPM settings and the update procedure, is in **[DEPLOY.md](DEPLOY.md)**.

**HTTPS is required, not cosmetic:** installing a PWA and reading GPS both need a secure context.
`localhost` is exempt, so development needs nothing extra.

Without Docker, [Caddy](https://caddyserver.com) in front of `npm start` is the smallest option:

```
bus.example.gr {
    reverse_proxy localhost:3000
}
```

To install on a phone, open the site in Chrome (Android) or Safari (iOS) and choose **Add to Home
Screen**. It then runs full screen with no browser chrome.

## Project layout

```
server/          Express proxy + token manager + cache; serves web/dist in production
  src/citybus.js   all upstream contact lives here
web/             React 19 + Vite + Leaflet PWA
  src/components/  StopMap · StopSheet · HomePanel · SettingsSheet
  src/hooks/       useStops · useLiveArrivals · useGeolocation · useFavourites
AGENTS.md        architecture notes, API reference, and why the tricky code is shaped as it is
DEPLOY.md        putting it on a server behind Nginx Proxy Manager
```

## API

The proxy exposes only what the app needs:

```
GET /api/config                             defaults this deployment started with
GET /api/cities                             all citybus.gr cities
GET /api/:city/stops?lang=el                every stop with coordinates
GET /api/:city/lines?lang=el                lines with colours and routes
GET /api/:city/stops/:code/live?lang=el     arrivals plus live vehicle positions
```

City slugs are validated against `[a-z0-9-]` before being interpolated into a hostname, so the proxy
can only ever reach a `citybus.gr` subdomain.

A `404` from the upstream live endpoint means *either* an unknown stop *or* no buses due in the next
30 minutes. The second is far more common, so it is surfaced as "no buses", not as an error.

## Map tiles

Tiles come from OpenStreetMap, which asks that heavy applications not use their public servers. At
community scale this is fine. If it grows, change `TILE_URL` in `web/src/components/StopMap.jsx` to
another provider — it is kept as a constant for exactly that.

## Contributing

`AGENTS.md` is the orientation doc: the API reference, the data quirks, and — most usefully — the
reasoning behind the parts of the code that look over-engineered but are load-bearing. Read it before
changing the polling, caching, or map-fitting logic.

User-facing strings live in `web/src/i18n.js` and need adding in both `el` and `en`.

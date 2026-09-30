# Deploying to your server

Written for a VM that already runs **Nginx Proxy Manager** in front of services like Jellyfin and
Immich, exposed on a public domain.

## Before you start

- A DNS record — say `bus.example.gr` — pointing at your VM's public IP.
- Ports **80 and 443** forwarded to Nginx Proxy Manager (it already needs these for your other
  services; Let's Encrypt validates over port 80).
- Docker and the compose plugin on the VM (x86_64 — the published image is `linux/amd64`).

**HTTPS is mandatory here, not a nicety.** Installing to a home screen and reading GPS both require a
secure context. Over plain HTTP the app still shows arrivals, but "Add to Home Screen" and "Near me"
will not work.

## 1. Get the compose file onto the VM

```bash
git clone https://github.com/GiorgosPap777/citybus-pwa.git citybus && cd citybus
```

Only `docker-compose.yml` is strictly needed — the image is published, so the VM never builds
anything. Cloning is just the easiest way to get the file and keep it updatable.

## 2. Start it

```bash
docker compose up -d
```

This pulls `giorgospap777/citybus-pwa:latest` (about 60 MB) and starts it. Check it came up:

```bash
docker compose ps && curl -s localhost:3000/api/health
```

You want `{"ok":true}`. If you prefer to watch it boot: `docker compose logs -f citybus`.

## 3. Point Nginx Proxy Manager at it

In NPM: **Hosts → Proxy Hosts → Add Proxy Host**.

**Details tab**

| Field | Value |
|---|---|
| Domain Names | `bus.example.gr` |
| Scheme | `http` |
| Forward Hostname / IP | your VM's LAN IP, e.g. `192.168.1.50` |
| Forward Port | `3000` |
| Cache Assets | **off** |
| Block Common Exploits | on |
| Websockets Support | off (unused) |

Leave **Cache Assets off**. The app already sets its own caching rules per endpoint, and live bus
times are explicitly `no-store` — an extra caching layer here risks showing stale arrival times,
which is the one thing this app must never do.

**SSL tab**

- SSL Certificate → **Request a new SSL Certificate**
- **Force SSL** on
- **HTTP/2 Support** on
- HSTS is fine to enable once you have confirmed it works

Save, then open `https://bus.example.gr`.

### Tidier alternative: put it on NPM's Docker network

If NPM runs in Docker on the same host, you can skip exposing a LAN port entirely. Find NPM's
network:

```bash
docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' <npm-container-name>
```

Then in `docker-compose.yml`, delete the `ports:` block and add:

```yaml
    networks:
      - npm
networks:
  npm:
    external: true
    name: <that-network-name>
```

Now set NPM's **Forward Hostname** to `citybus` and the port to `3000`. Nothing is reachable from the
LAN except through the proxy.

## 4. Check it worked

```bash
curl -s https://bus.example.gr/api/health
curl -s https://bus.example.gr/api/irakleio/stops | head -c 120
```

Then on your phone, open `https://bus.example.gr`, and use **Add to Home Screen** (Chrome's ⋮ menu on
Android, Safari's Share sheet on iOS). It should open full screen with no browser chrome, and
tapping **Εντοπισμός / Locate me** should prompt for location permission.

## Configuration

Edit `environment:` in `docker-compose.yml`, then `docker compose up -d`:

| Variable | Default | Meaning |
|---|---|---|
| `DEFAULT_CITY` | `irakleio` | City the app opens on |
| `DEFAULT_LANG` | `el` | `el` or `en` |
| `PORT` | `3000` | Port inside the container |
| `CACHE_DIR` | `/data` | Cache location; backed by a named volume |

These are only defaults for first-time visitors — anyone can pick their own city and language in the
app, stored in their own browser.

## Updating

```bash
docker compose pull && docker compose up -d
```

The service worker is set to `autoUpdate`, so phones pick up the new version on next launch without
being reinstalled.

`pull` updates the image, not your copy of `docker-compose.yml`. Compare it with the repository's
now and then. 1.3.0 added `mem_limit: 256m`, a backstop the server relies on if its memory ever runs
away, and a compose file copied before that runs without it. Check with:

```bash
docker inspect citybus --format '{{.HostConfig.Memory}}'   # 268435456, not 0
```

To pin a specific release instead of tracking `latest`, set the tag explicitly in
`docker-compose.yml`, e.g. `image: giorgospap777/citybus-pwa:1.0.0`.

## Backups

Almost nothing is worth backing up. The `citybus-cache` volume holds only scraped bearer tokens and
stop lists, all of which regenerate automatically. If you lose it, the first request after a restart
is simply a little slower.

## Troubleshooting

**"Add to Home Screen" is missing.** The site is not on HTTPS, or the certificate is not trusted.
Check the padlock. A self-signed certificate is not enough.

**"Near me" does nothing.** Same cause — geolocation is blocked outside a secure context. The app
shows a specific message when it detects this.

**Arrival times look frozen.** Check that Cache Assets is off in NPM, and that
`curl -sI https://bus.example.gr/api/irakleio/stops/0122/live` includes `cache-control: no-store`.

**A city shows "does not publish stop data".** Expected for `trikala` and `yper-xanthi` — their sites
exist but the upstream API has no data for them. Not fixable from here.

**Everything 502s.** The container is down or NPM points at the wrong address:
`docker compose ps` then `docker compose logs --tail=50 citybus`.

**Do not host it on a subpath** like `example.gr/bus`. The PWA manifest and service worker are scoped
to the domain root; a subpath needs `base` set in `web/vite.config.js` and the manifest `scope` and
`start_url` changed to match. A subdomain is much simpler.

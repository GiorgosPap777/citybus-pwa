import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';

import { getCities } from './cities.js';
import {
  getLines,
  getLiveArrivals,
  getRouteSequence,
  getRouteShape,
  getSchedule,
  getStops,
  HttpError,
} from './citybus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_CITY = process.env.DEFAULT_CITY || 'irakleio';
const DEFAULT_LANG = process.env.DEFAULT_LANG === 'en' ? 'en' : 'el';
const WEB_DIST = path.resolve(__dirname, '../../web/dist');

const app = express();
app.disable('x-powered-by');

// Small helper so route handlers can stay flat and let the error middleware
// turn an HttpError into the right status.
const route = (handler) => (req, res, next) => handler(req, res).catch(next);

const langOf = (req) => (req.query.lang === 'en' ? 'en' : req.query.lang === 'el' ? 'el' : DEFAULT_LANG);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Lets the front end discover the deployment's defaults instead of hardcoding them.
app.get('/api/config', (_req, res) =>
  res.json({ defaultCity: DEFAULT_CITY, defaultLang: DEFAULT_LANG }),
);

app.get('/api/cities', route(async (_req, res) => {
  res.set('cache-control', 'public, max-age=3600');
  res.json(await getCities());
}));

app.get('/api/:city/stops', route(async (req, res) => {
  const stops = await getStops(req.params.city, langOf(req));
  res.set('cache-control', 'public, max-age=3600');
  res.json(stops);
}));

app.get('/api/:city/lines', route(async (req, res) => {
  const lines = await getLines(req.params.city, langOf(req));
  res.set('cache-control', 'public, max-age=3600');
  res.json(lines);
}));

app.get('/api/:city/lines/:line/routes/:route/shape', route(async (req, res) => {
  const shape = await getRouteShape(req.params.city, req.params.line, req.params.route);
  res.set('cache-control', 'public, max-age=86400');
  res.json(shape);
}));

app.get('/api/:city/routes/:route/sequence', route(async (req, res) => {
  const sequence = await getRouteSequence(req.params.city, req.params.route);
  res.set('cache-control', 'public, max-age=86400');
  res.json(sequence);
}));

app.get('/api/:city/stops/:code/live', route(async (req, res) => {
  const arrivals = await getLiveArrivals(req.params.city, langOf(req), req.params.code);
  // Never let a browser or intermediary serve a stale bus time.
  res.set('cache-control', 'no-store');
  res.json(arrivals);
}));

app.get('/api/:city/stops/:code/schedule', route(async (req, res) => {
  const schedule = await getSchedule(req.params.city, langOf(req), req.params.code);
  // "Next departures" is relative to now; a cached copy would list buses long gone.
  res.set('cache-control', 'no-store');
  res.json(schedule);
}));

// Serve the built PWA when it exists, with an SPA fallback for client-side routes.
if (fs.existsSync(WEB_DIST)) {
  app.use(
    express.static(WEB_DIST, {
      index: 'index.html',
      // Vite content-hashes everything in assets/, so a URL there never changes
      // meaning. Without this each visit revalidates every file — a round trip
      // apiece over what is often a home uplink.
      setHeaders: (res, filePath) => {
        if (filePath.startsWith(path.join(WEB_DIST, 'assets') + path.sep)) {
          res.set('cache-control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  app.use((req, res, next) => {
    // HEAD as well as GET: uptime monitors and link previews use it, and were told
    // 404 for a page that GET serves.
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/')) return next();
    // A path with an extension is a file, never a client-side route. A page left
    // open across a deploy asks for its old hashed bundle, and answering that with
    // index.html (200) failed as a script that is HTML — a blank screen instead of
    // a plain 404.
    if (path.extname(req.path)) return next();
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
} else {
  console.warn(`[server] ${WEB_DIST} not found — API only. Run "npm run build" in web/ to serve the app.`);
}

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, _next) => {
  // Express's own errors carry a status too: a path parameter that is not valid
  // UTF-8 once decoded (%FF) is a 400. Treated as 500, each one also logged a full
  // stack trace, so anyone could flood the log.
  const clientError = err.status >= 400 && err.status < 500;
  const status = err instanceof HttpError ? err.status : clientError ? err.status : 500;
  // Upstream trouble gets one line: its message already says what failed, and in
  // an outage every poll lands here. Stack traces are kept for our own bugs.
  if (status >= 500 && err instanceof HttpError) {
    console.error(`[server] ${status} ${req.method} ${req.path}: ${err.message}`);
  } else if (status >= 500) {
    console.error('[server]', err);
  }
  // Only our own messages are written for clients.
  const message = err instanceof HttpError ? err.message : clientError ? 'Bad request' : 'Internal error';
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`citybus proxy on http://localhost:${PORT}  (default city: ${DEFAULT_CITY}, lang: ${DEFAULT_LANG})`);
});

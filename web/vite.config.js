import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Λεωφορεία — Citybus',
        short_name: 'Λεωφορεία',
        description: 'Ζωντανές αφίξεις λεωφορείων και θέσεις οχημάτων',
        lang: 'el',
        dir: 'ltr',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            // Live arrivals must never come from a cache — a stale bus time is
            // worse than no bus time. Listed first so it wins the match. The
            // schedule is "next departures from now", so a cached copy is just as wrong.
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/') &&
              (url.pathname.endsWith('/live') || url.pathname.endsWith('/schedule')),
            handler: 'NetworkOnly',
          },
          {
            // A route's street path changes only when the operator redraws it. Its
            // own cache, so viewing many routes cannot evict the stop lists below.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/') && url.pathname.endsWith('/shape'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'citybus-shapes',
              expiration: { maxEntries: 80, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Stops, lines and the city list barely change; serving them instantly
            // from cache is what makes the app usable on a bad connection.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'citybus-api',
              expiration: { maxEntries: 40, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
          {
            // Only status 200: an opaque (status 0) response counts as 6–11 MB of
            // storage in Chrome however small the tile is. Tiles are requested with
            // CORS (see StopMap), so a 0 here means something is wrong — pass it
            // through rather than cache it. Renamed from 'osm-tiles', which held
            // opaque tiles; main.jsx deletes that one.
            urlPattern: ({ url }) => url.hostname.endsWith('tile.openstreetmap.org'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles-v2',
              expiration: {
                maxEntries: 600,
                maxAgeSeconds: 7 * 24 * 60 * 60,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
});

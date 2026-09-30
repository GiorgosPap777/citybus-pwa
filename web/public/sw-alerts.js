// Loaded into the generated service worker (workbox.importScripts in
// vite.config.js). An arrival alert's notification has nothing to do when tapped
// unless the worker handles it: bring the app forward, or open it if it has gone.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => 'focus' in client);
      return open ? open.focus() : self.clients.openWindow('/');
    }),
  );
});

/* The build replaces APP_VERSION with a content hash. Never mix asset versions. */
const CACHE = 'ranizow-APP_VERSION';
const ASSETS = ['./', 'index.html', 'style.css', 'data.json', 'privacy.html', 'manifest.webmanifest', 'assets/icon.svg', 'assets/icon-192.png', 'assets/icon-512.png', 'js/calendar.js', 'js/services.js', 'js/planner.js', 'js/app.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ranizow-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Network first for the schedule, falling back only to a saved schedule.
  if (url.pathname.endsWith('/data.json')) {
    event.respondWith(fetch(event.request).then(response => {
      if (!response.ok) throw new Error('Schedule unavailable');
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(c => c.put(event.request, copy)));
      return response;
    }).catch(() => caches.match(event.request).then(r => r || Response.error())));
    return;
  }
  url.search = ''; // Hosting may append ?i=1; keep offline navigation working.
  const asset = ASSETS.some(path => new URL(path, self.registration.scope).href === url.href);
  if (asset) event.respondWith(caches.open(CACHE).then(c => c.match(url.href)).then(cached => cached || fetch(event.request)));
});

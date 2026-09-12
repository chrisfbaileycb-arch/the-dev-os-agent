/*
 * Shell worker for the web edition. The build fills in VERSION and SHELL from the
 * emitted bundle, so dist/sw.js is generated; edit this template instead.
 *
 * Contract:
 *   - Precache the app shell (index.html, hashed assets, manifest, icons) so the
 *     installed app opens offline and the scripted preview keeps working.
 *   - Never touch the API: anything under api/ goes straight to the network.
 *   - Only GET requests on this origin, inside the registration scope.
 *   - Navigations are network first and fall back to the cached shell offline.
 *   - Hashed assets are cache first; cache misses are fetched and stored.
 */
const VERSION = '__VERSION__';
const SHELL = __SHELL__;
const CACHE = 'shell-' + VERSION;
const scopeUrl = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL.map(scopeUrl))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return;
  const relative = url.pathname.slice(scopePath.length);
  if (relative.startsWith('api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(scopeUrl('index.html')).then((hit) => hit || Response.error())));
    return;
  }
  if (!SHELL.includes(relative)) return;
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); }
    return response;
  })));
});

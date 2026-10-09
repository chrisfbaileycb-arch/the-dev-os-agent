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
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL.map(scopeUrl))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function handleShare(request) {
  let title = '';
  let text = '';
  try {
    const form = await request.formData();
    title = String(form.get('title') || '').slice(0, 200);
    text = String(form.get('text') || '');
    const file = form.get('file');
    if (file && typeof file.text === 'function') {
      const name = String(file.name || '');
      if (!name || /\.(md|txt)$/i.test(name)) text = await file.text();
    }
  } catch { /* a share with no body still opens the chat */ }
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: 'share', title, text: text.slice(0, 60000) });
  return Response.redirect(new URL('./?view=chat', self.registration.scope), 303);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return;
  const relative = url.pathname.slice(scopePath.length);
  if (request.method === 'POST' && (relative === 'share-target' || relative === 'share-target/')) {
    event.respondWith(handleShare(request));
    return;
  }
  if (request.method !== 'GET') return;
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

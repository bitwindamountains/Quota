/* global self, caches, fetch, URL */
// Only public offline-help assets are cached. No dashboard, API, or credential caching.
const CACHE = 'quota-offline-v1';
const PUBLIC_FILES = ['/offline.html', '/offline.css', '/icons/quota-192.png', '/icons/quota-512.png', '/icons/quota-maskable.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PUBLIC_FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('quota-offline-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.open(CACHE)).match('/offline.html')));
  } else if (!url.search && PUBLIC_FILES.includes(url.pathname)) {
    event.respondWith(fetch(event.request).catch(async () => (await caches.open(CACHE)).match(url.pathname)));
  }
});

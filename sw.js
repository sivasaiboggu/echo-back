const cachePrefix = `echo-back:${self.registration.scope}:`;
const cacheName = `${cachePrefix}__BUILD_VERSION__`;
const assets = __APP_FILES__;
const url = (path) => new URL(path, self.registration.scope).href;
const cachedUrls = new Set(assets.map(url));
const home = url('./index.html');

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll([...cachedUrls])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(cachePrefix) && name !== cacheName)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const requested = new URL(request.url);
  const pathname = requested.origin + requested.pathname;
  const entry = pathname === self.registration.scope ? home : pathname;
  if (!cachedUrls.has(entry)) return;

  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    try {
      return await fetch(request);
    } catch {
      return (await cache.match(entry)) || Response.error();
    }
  })());
});

/* Generated from scripts/sw-template.js. Private notes live in IndexedDB, never response caches. */
const SHELL = 'notizen-shell-__VERSION__';
const IMAGES = 'notizen-images-v1';
const ASSETS = __ASSETS__;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(ASSETS)));
  // Do not skipWaiting: an open editor must finish with the assets it was loaded with.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('notizen-shell-') && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});
function imageAllowed(url) {
  return (url.origin === self.location.origin && url.pathname.startsWith('/uploads/')) ||
    (url.origin === 'https://storage.googleapis.com' && url.pathname.startsWith('/notizen-uploads-prod/'));
}
async function rememberImage(request, response) {
  if (!response.ok && response.type !== 'opaque') return;
  try {
    const cache = await caches.open(IMAGES);
    await cache.put(request, response);
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - 80))) await cache.delete(key);
  } catch { /* Image cache quota must never block text notes. */ }
}
self.addEventListener('message', event => {
  if (event.data?.type === 'CLEAR_IMAGES') event.waitUntil(caches.delete(IMAGES));
  if (event.data?.type === 'CACHE_IMAGES') event.waitUntil((async () => {
    const urls = [...new Set(event.data.urls || [])].slice(0, 80);
    for (const value of urls) {
      let url; try { url = new URL(value, self.location.origin); } catch { continue; }
      if (!imageAllowed(url)) continue;
      try {
        const req = new Request(url, { mode: 'no-cors', credentials: 'omit' });
        const cache = await caches.open(IMAGES);
        if (!await cache.match(req)) await rememberImage(req, await fetch(req));
      } catch { /* Try again next time online. */ }
    }
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (url.origin === self.location.origin && req.mode === 'navigate' &&
      (url.pathname === '/' || url.pathname === '/offline' || url.pathname === '/notes' || url.pathname.startsWith('/notes/'))) {
    event.respondWith((async () => {
      try {
        const response = await fetch(req);
        if (response.status < 500) return response;
      } catch { /* Use the public shell, not cached authenticated HTML. */ }
      return (await caches.open(SHELL)).match('/offline');
    })());
  } else if (url.origin === self.location.origin && ASSETS.includes(url.pathname)) {
    event.respondWith((async () => (await (await caches.open(SHELL)).match(url.pathname)) || fetch(req))());
  } else if (imageAllowed(url)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(req);
        if (!response.ok && response.type !== 'opaque') throw new Error('Image unavailable');
        event.waitUntil(rememberImage(req, response.clone()));
        return response;
      } catch { return (await (await caches.open(IMAGES)).match(req)) || Response.error(); }
    })());
  }
});

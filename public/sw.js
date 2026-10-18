const CACHE = 'lifts-coach-v1';
const assets = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(async cache => {
  const responses = await Promise.all(assets.map(path => fetch(new Request(path, { cache: 'reload' }))));
  if (responses.some(response => !response.ok || response.redirected)) throw new Error('Application assets require authentication.');
  await Promise.all(responses.map((response, index) => cache.put(assets[index], response)));
})); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('lifts-coach-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn-cgi/')) return;
  // Only release-listed static URLs may enter the offline cache. Never retain
  // query strings or future authenticated endpoints alongside the app shell.
  const staticAsset = assets.includes(url.pathname) && !url.search;
  if (!staticAsset && request.mode !== 'navigate') return;
  event.respondWith(fetch(request).then(response => {
    if (staticAsset && response.ok && response.type === 'basic' && !response.redirected && !/\bno-store\b/i.test(response.headers.get('cache-control') || '') && (request.mode !== 'navigate' || response.headers.get('content-type')?.includes('text/html'))) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy))); }
    return response;
  }).catch(async () => { const cache = await caches.open(CACHE); return (staticAsset && await cache.match(request)) || (request.mode === 'navigate' && await cache.match('/')) || Response.error(); }));
});

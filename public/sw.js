const CACHE = 'lifts-coach-v1';
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(async cache => {
  const assets = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
  const responses = await Promise.all(assets.map(path => fetch(new Request(path, { cache: 'reload' }))));
  if (responses.some(response => !response.ok || response.redirected)) throw new Error('Application assets require authentication.');
  await Promise.all(responses.map((response, index) => cache.put(assets[index], response)));
})); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn-cgi/')) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok && response.type === 'basic' && !response.redirected && (request.mode !== 'navigate' || response.headers.get('content-type')?.includes('text/html'))) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
    return response;
  }).catch(async () => (await caches.match(request)) || (request.mode === 'navigate' ? await caches.match('/') : Response.error())));
});

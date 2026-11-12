// Keeps the app opening with no signal. Serves the saved copy first and
// refreshes it in the background, so an update shows on the next open.
const CACHE = 'plate-v6';
const SHELL = ['./', 'app.css', 'js/app.js', 'js/store.js', 'js/engine.js', 'js/parse.js', 'js/draw.js', 'js/sync.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).pathname.includes('/api/')) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const saved = await cache.match(req);
    const fresh = fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    }).catch(() => saved);
    return saved || fresh;
  }));
});

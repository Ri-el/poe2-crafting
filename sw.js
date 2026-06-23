// Auto-updating service worker for the PoE2 jewel crafting sim.
//
// You should NEVER need to bump a version number here again.
//  - Strategy is NETWORK-FIRST for everything: while your local server is
//    running, every reload pulls the freshest file straight from disk, so
//    code/CSS/HTML edits show up immediately on a normal refresh.
//  - The cache is only a fallback for when the server is offline.
//  - On activate we delete EVERY old cache automatically, so stale assets
//    can never pile up regardless of name.
//  - skipWaiting + clients.claim means a new worker takes over instantly.

const CACHE_NAME = 'poe2-craft'; // static on purpose — no version bumping needed

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './select.css',
  './desecrate.css',
  './app.js',
  './select.js',
  './crafting.js',
  './data/jewel-mods.v2.json',
  './data/desecrated-mods.json',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  // Take over right away; don't wait for old tabs to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Nuke ALL caches except the current one — fully automatic cleanup.
      .then((names) =>
        Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  );
});

// Optional: lets the page tell a waiting worker to activate immediately.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // NETWORK-FIRST for every GET: fresh content always wins when reachable,
  // and we keep the cache updated as a side effect for offline use.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || caches.match('./index.html'))
      )
  );
});

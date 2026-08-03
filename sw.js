/* Bump this string alongside Game.VERSION in js/engine.js on every release.
   A new CACHE_NAME forces the activate handler to purge the old cache, so
   returning visitors pick up the new bundle on their next page load. */
var CACHE_NAME = 'momoko-treehouse-v1.2.0';
var ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/i18n.js',
  './js/audio.js',
  './js/input.js',
  './js/levels.js',
  './js/entities.js',
  './js/tree.js',
  './js/ui.js',
  './js/piano.js',
  './js/engine.js',
  './js/pwa.js',
  './manifest.json',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_NAME; })
             .map(function (n) { return caches.delete(n); })
      );
    })
  );
  self.clients.claim();
});

/* Network-first with cache fallback: always try the network so returning
   visitors see fresh code, but fall back to the cache when offline so the
   PWA still works without a connection. Successful responses refresh the
   cache entry so the offline fallback stays current. */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var clone = res.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(e.request, clone);
          });
        }
        return res;
      })
      .catch(function () {
        return caches.match(e.request);
      })
  );
});

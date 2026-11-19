// Service worker: precache the whole app so it opens offline after the first load.
// Bump VERSION whenever any app file changes, so installed copies pick up the update
// (the new version activates the next time the app is opened).
const VERSION = 'v5';
const CACHE = `time-tracker-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './design/tokens.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/csv.js',
  './js/format.js',
  './js/history.js',
  './js/settings.js',
  './js/sheets.js',
  './js/store.js',
  './js/swipe.js',
  './js/sync.js',
  './js/team.js',
  './js/timer.js',
  './js/ui.js',
  './icons/apple-touch-icon.png',
  './icons/icon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon.svg',
  './icons/splash-1179x2556.png',
  './icons/splash-1206x2622.png',
  './icons/splash-1260x2736.png',
  './icons/splash-1290x2796.png',
  './icons/splash-1320x2868.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('time-tracker-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache first: the app shell never changes within a version. Same-origin GETs only.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html', { cacheName: CACHE }).then((hit) => hit || fetch(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(request)),
  );
});

/* Service worker: приложение открывается и работает без интернета (в электричке).
   При обновлении сайта поменяйте VERSION — старый кэш удалится. */

const VERSION = 'ramki-v12';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/config.js', 'js/util.js', 'js/schedule.js', 'js/planner.js', 'js/practice.js',
  'js/parse.js', 'js/ics.js', 'js/store.js', 'js/ui.js', 'js/nav.js', 'js/bank.js', 'js/theory.js', 'js/modules.js',
  'js/views/shared.js', 'js/views/calendar.js', 'js/views/events.js', 'js/views/day.js',
  'js/views/today.js', 'js/views/topics.js', 'js/views/settings.js',
  'data/bank.json', 'data/theory.json',
  'modules/kinematics/index.html', 'modules/kinematics/seed.json', 'modules/bits/index.html', 'modules/bits/seed.json',
  'fonts/playfair-display-cyrillic-400-normal.woff2', 'fonts/playfair-display-latin-400-normal.woff2',
  'fonts/playfair-display-cyrillic-600-normal.woff2', 'fonts/playfair-display-latin-600-normal.woff2',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' — мимо HTTP-кэша браузера, чтобы новая версия не собралась из старых файлов
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Банк заданий и теория — сначала сеть (чтобы новое подтягивалось), без сети — из кэша.
  if (url.pathname.endsWith('/data/bank.json') || url.pathname.endsWith('/data/theory.json')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  // Остальное — из кэша сразу, а в фоне обновить.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || net;
    }),
  );
});

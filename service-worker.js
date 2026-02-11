// Basic offline handler for static assets (kept lean for this prototype).
// We aggressively bypass Supabase calls to ensure live auth/token flow.
const CACHE_NAME = 'venice-local-cache-v9';
const OFFLINE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './renderer.js',
  './assets/vendor/supabase.js',
  './manifest.json',
  './assets/venice-local.png',
  './assets/Default_pfp.svg.png',
  './assets/Venice Local main page.png',
  './assets/sun.webp',
  './assets/bird.png'
];

// Cache core assets during install so the shell can load offline.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_ASSETS))
  );
});

// Remove outdated caches when a new worker activates.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
          return null;
        })
      )
    )
  );
});

// Serve cached assets when possible; always bypass cache for Supabase calls.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Never cache Supabase/API calls; always hit network so auth headers work.
  const url = new URL(request.url);
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(request).catch(() => Response.error()));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});

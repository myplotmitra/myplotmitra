// OnePercent Real Estate — Service Worker
// Handles offline caching and PWA install

const CACHE_NAME = 'onepercent-v1';
const CACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500;600&display=swap',
];

// Install — cache core assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching core assets');
      return cache.addAll(CACHE_URLS).catch(err => {
        console.log('[SW] Some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch — network first, fallback to cache
self.addEventListener('fetch', (e) => {
  // Skip Firebase and Google API calls — always go to network
  if (
    e.request.url.includes('firestore.googleapis.com') ||
    e.request.url.includes('firebase') ||
    e.request.url.includes('googleapis.com') ||
    e.request.url.includes('gstatic.com')
  ) {
    return;
  }

  // For HTML navigation — network first, fallback to cached index
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // For everything else — stale while revalidate
  e.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(e.request);
      const fetchPromise = fetch(e.request)
        .then((response) => {
          if (response.ok) cache.put(e.request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Push notifications
self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || '1% Real Estate';
  const body  = data.body  || 'You have a new notification';
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:  '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      data:  data.data || {},
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.openWindow(e.notification.data?.url || '/')
  );
});

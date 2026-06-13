// MyPlotMitra — Service Worker
// Offline shell + safe caching. Push support is ready but optional.
// Never caches Firebase / Razorpay / API calls.

const CACHE = 'mpm-v3';
const CORE = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  if (
    e.request.method !== 'GET' ||
    url.includes('/api/') ||
    url.includes('firestore.googleapis.com') ||
    url.includes('firebase') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com') ||
    url.includes('razorpay.com') ||
    url.includes('google-analytics') ||
    url.includes('identitytoolkit')
  ) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy)).catch(() => {});
          return r;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const cached = await c.match(e.request);
      const live = fetch(e.request)
        .then((r) => { if (r && r.ok) c.put(e.request, r.clone()); return r; })
        .catch(() => cached);
      return cached || live;
    })
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  const data = d.data || d.notification || d;
  e.waitUntil(
    self.registration.showNotification(data.title || 'MyPlotMitra', {
      body: data.body || 'You have a new update',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
      vibrate: [180, 90, 180],
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(e.notification.data?.url || '/'));
});

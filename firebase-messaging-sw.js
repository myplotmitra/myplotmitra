// MyPlotMitra — Firebase Cloud Messaging service worker
// Required by FCM to receive push notifications when the app is closed.
// Lives at the site root so its scope covers the whole app.

importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCMFjanKid7Bw7-w084beGMRwvjn0WMfT4',
  authDomain: 'myplotmitra-d692c.firebaseapp.com',
  projectId: 'myplotmitra-d692c',
  storageBucket: 'myplotmitra-d692c.firebasestorage.app',
  messagingSenderId: '686781189764',
  appId: '1:686781189764:web:c4fc3e669e8fb0b3b6bcd1',
});

const messaging = firebase.messaging();

// Background messages → show a notification
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || payload.notification || {};
  self.registration.showNotification(d.title || 'MyPlotMitra', {
    body: d.body || 'You have a new update',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: d.url || 'https://www.myplotmitra.com/' },
    vibrate: [180, 90, 180],
    tag: 'mpm-msg',
  });
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || 'https://www.myplotmitra.com/'));
});

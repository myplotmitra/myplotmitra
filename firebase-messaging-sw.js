// MyPlotMitra — Firebase Cloud Messaging service worker
// Required by FCM to receive push notifications when the app is closed.
// Lives at the site root so its scope covers the whole app.

importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  "apiKey": "AIzaSyAnmBJavyJBmxTaM9jqNI7gajr1U3BVZ1E",
  "authDomain": "myplotmitra-preview-d8c47.firebaseapp.com",
  "projectId": "myplotmitra-preview-d8c47",
  "storageBucket": "myplotmitra-preview-d8c47.firebasestorage.app",
  "messagingSenderId": "109977955626",
  "appId": "1:109977955626:web:b8b7d40414703843434253"
});

const messaging = firebase.messaging();

// Background messages → show a notification
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || payload.notification || {};
  self.registration.showNotification(d.title || 'MyPlotMitra', {
    body: d.body || 'You have a new update',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: d.url || self.location.origin },
    vibrate: [180, 90, 180],
    tag: 'mpm-msg',
  });
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || self.location.origin));
});

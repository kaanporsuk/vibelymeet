// Service Worker for Vibely Push Notifications
// Note: Production web push uses OneSignal (see public/OneSignalSDK.sw.js). Quiet hours and message
// bundling (collapse_id) are enforced in supabase/functions/send-notification before OneSignal sends.
// This file handles legacy SCHEDULE_NOTIFICATION / SHOW_NOTIFICATION helpers and generic push fallbacks.
const CACHE_NAME = 'vibely-v1';

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(clients.claim());
});

// Listen for push notifications
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received:', event);
  
  let data = {
    title: 'Vibely',
    body: 'You have a new notification!',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'vibely-notification',
    data: {}
  };

  // Try to parse push data
  if (event.data) {
    try {
      const pushData = event.data.json();
      data = { ...data, ...pushData };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/favicon.ico',
    badge: data.badge || '/favicon.ico',
    tag: data.tag || 'vibely-notification',
    vibrate: [200, 100, 200],
    data: data.data || {},
    actions: data.actions || [],
    requireInteraction: data.requireInteraction || false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event);
  
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If a window is already open, focus it
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus();
            if (urlToOpen !== '/') {
              client.navigate(urlToOpen);
            }
            return;
          }
        }
        // Otherwise open a new window
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Handle background sync for scheduled notifications
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'check-daily-drop') {
    event.waitUntil(checkDailyDropNotification());
  }
});

// Check and fire daily drop notification
async function checkDailyDropNotification() {
  const now = new Date();
  const hour = now.getHours();
  
  // Only fire at 6 PM (18:00)
  if (hour === 18) {
    await self.registration.showNotification('💧 Your Daily Drop is Here!', {
      body: 'A new curated match is waiting for you. Open Vibely to see who it is!',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'daily-drop',
      vibrate: [200, 100, 200],
      data: { url: '/matches' },
      requireInteraction: true,
    });
  }
}

// Listen for messages from the main thread
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data.type === 'SCHEDULE_NOTIFICATION') {
    const { id, title, body, scheduledAt, url } = event.data.payload;
    
    const delay = new Date(scheduledAt).getTime() - Date.now();
    
    if (delay > 0) {
      console.log(`[SW] Scheduling notification "${id}" in ${Math.round(delay / 1000 / 60)} minutes`);
      setTimeout(() => {
        self.registration.showNotification(title, {
          body,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: id,
          vibrate: [200, 100, 200, 100, 200],
          data: { url: url || '/' },
          requireInteraction: true, // Keep notification visible until user interacts
          actions: [
            { action: 'open', title: 'Open' },
            { action: 'dismiss', title: 'Dismiss' }
          ]
        });
      }, delay);
    } else {
      console.log(`[SW] Notification "${id}" time has passed, skipping`);
    }
  }
  
  if (event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, url } = event.data.payload;
    self.registration.showNotification(title, {
      body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: tag || 'vibely-notification',
      vibrate: [200, 100, 200],
      data: { url: url || '/' },
      requireInteraction: true,
      actions: [
        { action: 'open', title: 'Open' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    });
  }
});

// Periodic background sync for daily drops (if supported)
self.addEventListener('periodicsync', (event) => {
  console.log('[SW] Periodic sync:', event.tag);
  
  if (event.tag === 'daily-drop-check') {
    event.waitUntil(checkDailyDropNotification());
  }
});

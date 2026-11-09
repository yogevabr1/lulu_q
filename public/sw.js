// Caches nothing: no private content is ever stored on the device.
// Pushes arrive empty, so the notification text is always neutral.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  e.waitUntil(self.registration.showNotification('Lulu', {
    body: 'יש עדכון חדש',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'lulu',
    renotify: true
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if ('focus' in c) return c.focus();
    return self.clients.openWindow('/');
  })());
});

// Deliberately caches nothing: no private content is ever stored on the device.
// It exists so the app can be installed, and later for push notifications.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

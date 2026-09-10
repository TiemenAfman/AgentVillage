// The smallest service worker that will do, and deliberately no smaller and no bigger.
//
// Its only job is to make the island installable: a browser will not offer to add a page
// to the home screen unless a worker with a fetch handler is in charge of it. It caches
// nothing at all. That is on purpose - the server sends its own code with no-store so the
// island updates the moment you save a file, and a caching worker would spend the rest of
// its life fighting that and winning.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* straight to the network, every time */ });

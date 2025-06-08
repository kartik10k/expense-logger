const CACHE_NAME = 'expense-logger-cache';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/config.js'
];

// Install event - cache assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting()) // Activate new service worker immediately
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            self.skipWaiting();
            self.clients.claim();
        }) // Take control of all clients
    );
});

// Fetch event - serve from cache, fall back to network
self.addEventListener('fetch', event => {
    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Cache the new response
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, response.clone());
                });
                return response;
            })
            .catch(() => {
                // If network fails, try to serve from cache
                return caches.match(event.request);
            })
    );
});

// Listen for messages from the main thread
self.addEventListener('message', event => {
    if (event.data === 'CHECK_UPDATE') {
        // Check for updates
        fetch('/')
            .then(response => {
                if (response.status === 200) {
                    // Notify the main thread that an update is available
                    self.clients.matchAll().then(clients => {
                        clients.forEach(client => {
                            client.postMessage('UPDATE_AVAILABLE');
                        });
                    });
                }
            });
    }
}); 
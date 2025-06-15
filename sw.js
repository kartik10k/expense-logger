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

// Fetch event - serve from cache, then network, and update cache
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                const fetchPromise = fetch(event.request)
                    .then(networkResponse => {
                        // Check if we received a valid response
                        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                            const clonedResponse = networkResponse.clone();
                            caches.open(CACHE_NAME).then(cache => {
                                cache.put(event.request, clonedResponse);
                            });
                        }
                        return networkResponse;
                    }).catch(error => {
                        console.error('Fetch failed:', error);
                        // If both cache and network fail, you might want to return an offline page
                        return new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
                    });

                // Return cached response immediately if available, otherwise wait for network
                return cachedResponse || fetchPromise;
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
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
}); 
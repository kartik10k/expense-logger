const CACHE_NAME = 'expense-logger-cache-v3';
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
            self.clients.claim(); // Take control of all clients
        })
    );
});

// Fetch event - network-first for HTML/JS, cache-first for others
self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);

    // For HTML documents and JavaScript files, try network first
    if (requestUrl.pathname === '/' || requestUrl.pathname.endsWith('.html') || requestUrl.pathname.endsWith('.js')) {
        event.respondWith(
            fetch(event.request)
                .then(networkResponse => {
                    // Cache the new response
                    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                        const clonedResponse = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, clonedResponse);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => {
                    // If network fails, try to serve from cache
                    return caches.match(event.request);
                })
        );
    } else {
        // For other assets (CSS, images, etc.), try cache first
        event.respondWith(
            caches.match(event.request)
                .then(cachedResponse => {
                    // Return cached response if available, otherwise fetch from network
                    return cachedResponse || fetch(event.request).then(networkResponse => {
                        // Cache the new response
                        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                            const clonedResponse = networkResponse.clone();
                            caches.open(CACHE_NAME).then(cache => {
                                cache.put(event.request, clonedResponse);
                            });
                        }
                        return networkResponse;
                    }).catch(() => {
                        // If both cache and network fail, you might want to return a fallback
                        return new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
                    });
                })
        );
    }
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
    if (event.data === 'CHECK_FOR_UPDATE') {
        // Force check for updates by requesting the root with no-cache
        fetch('/', { cache: 'no-store' })
            .then(response => {
                if (response.status === 200) {
                    // If the fetch is successful, it means we got the latest version.
                    // Compare with cached version or simply signal reload to activate new SW.
                    // For simplicity, we can just signal the client to reload to pick up new SW.
                    self.clients.matchAll().then(clients => {
                        clients.forEach(client => {
                            client.postMessage('RELOAD_APP');
                        });
                    });
                }
            }).catch(error => {
                console.error('Failed to fetch for update:', error);
            });
    }
}); 
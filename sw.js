const CACHE_NAME = 'expense-logger-cache';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Fetch event - serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Return cached response if found
                if (response) {
                    return response;
                }
                
                // Otherwise fetch from network
                return fetch(event.request)
                    .then(response => {
                        // Cache the fetched response
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            });
                        
                        return response;
                    });
            })
    );
});

// Listen for messages from the client
self.addEventListener('message', (event) => {
    if (event.data === 'CHECK_UPDATE') {
        // Only check for updates if explicitly requested
        fetch('index.html')
            .then(response => response.text())
            .then(newContent => {
                caches.match('index.html')
                    .then(response => response.text())
                    .then(oldContent => {
                        if (newContent !== oldContent) {
                            // Update cache with new content
                            caches.open(CACHE_NAME)
                                .then(cache => {
                                    cache.put('index.html', new Response(newContent));
                                    // Notify clients about the update
                                    self.clients.matchAll().then(clients => {
                                        clients.forEach(client => {
                                            client.postMessage('UPDATE_AVAILABLE');
                                        });
                                    });
                                });
                        }
                    });
            })
            .catch(error => {
                console.error('Error checking for updates:', error);
            });
    }
}); 
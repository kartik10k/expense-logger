const CACHE_NAME = 'expense-logger-cache';
const ASSETS_TO_CACHE = [
    '.',
    'index.html',
    'styles.css',
    'app.js',
    'manifest.json',
    'icons/icon-192x192.png',
    'icons/icon-512x512.png'
];

// Function to check for updates
async function checkForUpdates() {
    try {
        const response = await fetch('index.html', { cache: 'no-store' });
        const newCache = await caches.open(CACHE_NAME);
        
        // Check if the content has actually changed
        const cachedResponse = await caches.match('index.html');
        if (cachedResponse) {
            const cachedText = await cachedResponse.text();
            const newText = await response.text();
            
            if (cachedText === newText) {
                return false; // No changes
            }
        }
        
        // Update cache only if content has changed
        await newCache.addAll(ASSETS_TO_CACHE);
        return true;
    } catch (error) {
        console.error('Update check failed:', error);
        return false;
    }
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Return cached response if found
                if (response) {
                    return response;
                }
                
                // If not in cache, fetch from network
                return fetch(event.request)
                    .then(networkResponse => {
                        if (networkResponse.ok) {
                            const responseToCache = networkResponse.clone();
                            caches.open(CACHE_NAME)
                                .then(cache => {
                                    cache.put(event.request, responseToCache);
                                });
                        }
                        return networkResponse;
                    });
            })
    );
});

// Listen for messages from the client
self.addEventListener('message', (event) => {
    if (event.data === 'CHECK_UPDATE') {
        checkForUpdates().then(updated => {
            if (updated) {
                // Notify all clients about the update
                self.clients.matchAll().then(clients => {
                    clients.forEach(client => {
                        client.postMessage('UPDATE_AVAILABLE');
                    });
                });
            }
        });
    }
}); 
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
    // Check for updates when the app is opened
    if (event.request.url.endsWith('index.html')) {
        event.respondWith(
            (async () => {
                const cachedResponse = await caches.match(event.request);
                const networkResponse = await fetch(event.request);
                
                // If the network response is different from cache, update the cache
                if (cachedResponse && networkResponse) {
                    const cachedText = await cachedResponse.text();
                    const networkText = await networkResponse.text();
                    
                    if (cachedText !== networkText) {
                        const newCache = await caches.open(CACHE_NAME);
                        await newCache.addAll(ASSETS_TO_CACHE);
                    }
                }
                
                return networkResponse;
            })()
        );
    } else {
        event.respondWith(
            caches.match(event.request)
                .then((response) => response || fetch(event.request))
        );
    }
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
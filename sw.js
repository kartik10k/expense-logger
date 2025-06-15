const CACHE_PREFIX = 'expense-logger-cache';
// Determine the current app version from the service worker's URL query parameter
const urlParams = new URLSearchParams(self.location.search);
const APP_VERSION = urlParams.get('v') || 'unknown';
const CACHE_NAME = `${CACHE_PREFIX}-v${APP_VERSION}`;

const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/config.js'
];

// Install event - cache assets
self.addEventListener('install', event => {
    console.log(`[Service Worker] Installing. Caching ${CACHE_NAME}`);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting()) // Force new service worker to activate immediately
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    console.log('[Service Worker] Activating. Cleaning old caches.');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME) {
                        console.log(`[Service Worker] Deleting old cache: ${cacheName}`);
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
                    // Cache the new response only if successful and valid
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
                    console.log('[Service Worker] Network failed for HTML/JS, trying cache.');
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
                        // Cache the new response only if successful and valid
                        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                            const clonedResponse = networkResponse.clone();
                            caches.open(CACHE_NAME).then(cache => {
                                cache.put(event.request, clonedResponse);
                            });
                        }
                        return networkResponse;
                    }).catch(() => {
                        // If both cache and network fail, you might want to return a fallback
                        console.log('[Service Worker] Network failed for asset, returning offline fallback.');
                        return new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
                    });
                })
        );
    }
});

// Listen for messages from the main thread
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
}); 
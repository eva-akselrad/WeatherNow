/* ════════════════════════════════════════════════════════════════
   sw.js – S.H.E.L.L.Y. Service Worker
   • Caches app shell for offline use
   • Network-first for external APIs (caches last successful response)
   • Cache-first for static assets
   • Handles Web Push notifications
   ════════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'shelly-v1';
const APP_SHELL = [
    '/',
    '/index.html',
    '/css/weather.css',
    '/js/settings.js',
    '/js/music.js',
    '/js/weather.js',
    '/js/alerts.js',
    '/js/radar.js',
    '/js/displays.js',
    '/js/app.js',
    '/js/announcements.js',
    '/js/pwa.js',
    '/assets/favicon.png',
    '/manifest.json',
];

// External domains whose responses we cache (last-good fallback)
const CACHE_EXTERNAL_PATTERNS = [
    'api.weather.gov',
    'api.open-meteo.com',
    'air-quality-api.open-meteo.com',
    'nominatim.openstreetmap.org',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
];

// ── Install: pre-cache app shell ────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

// ── Activate: clean up old caches ───────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys
                .filter(k => k !== CACHE_VERSION)
                .map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// ── Fetch strategy ───────────────────────────────────────────────
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET and chrome-extension etc
    if (request.method !== 'GET') return;
    if (!['http:', 'https:'].includes(url.protocol)) return;

    const isLocal = url.origin === self.location.origin;
    const isExternalCacheable = CACHE_EXTERNAL_PATTERNS.some(p => url.hostname.includes(p));

    if (isLocal) {
        // Local API routes: network only (real-time data)
        if (url.pathname.startsWith('/api/')) {
            event.respondWith(fetch(request));
            return;
        }
        // App shell: cache-first, fall back to network
        event.respondWith(cacheFirst(request));
    } else if (isExternalCacheable) {
        // External weather/geocoding APIs: network-first, cache as fallback
        event.respondWith(networkFirstWithCache(request));
    }
    // All other external requests (Leaflet CDN, etc.): browser default
});

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_VERSION);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('Offline – cached version not available', { status: 503 });
    }
}

async function networkFirstWithCache(request) {
    const cache = await caches.open(CACHE_VERSION);
    try {
        const response = await fetch(request);
        if (response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: 'offline', cached: false }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// ── Push: show OS notification ──────────────────────────────────
self.addEventListener('push', event => {
    let data = { title: 'S.H.E.L.L.Y.', body: 'New message from S.H.E.L.L.Y.' };
    try {
        if (event.data) data = { ...data, ...event.data.json() };
    } catch { /* keep defaults */ }

    const options = {
        body: data.body,
        icon: '/assets/favicon.png',
        badge: '/assets/favicon.png',
        tag: data.tag || 'shelly-notification',
        renotify: true,
        data: { url: data.url || '/' },
        vibrate: [200, 100, 200],
    };

    // Color the notification based on type
    if (data.type === 'emergency') options.urgency = 'high';

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// ── Notification click: focus/open app window ───────────────────
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // Focus existing window if open
            for (const client of windowClients) {
                if (new URL(client.url).pathname === targetUrl && 'focus' in client) {
                    return client.focus();
                }
            }
            // Otherwise open new window
            if (clients.openWindow) return clients.openWindow(targetUrl);
        })
    );
});

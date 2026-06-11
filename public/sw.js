// /public/sw.js

const CACHE_NAME = 'rendler-offline-v124';
const MAX_RUNTIME_IMAGE_BYTES = 50 * 1024 * 1024;
const OFFLINE_CACHE_PREFIX = 'rendler-offline-';
const NAVIGATION_NETWORK_TIMEOUT_MS = 1500;

const OFFLINE_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>Offline Mode</title>
    <style>
        body { background: #050c1d; color: #e2e8f0; font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
        .card { background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 20px; padding: 40px; text-align: center; max-width: 320px; backdrop-filter: blur(12px); }
        .icon { font-size: 56px; margin-bottom: 20px; display: block; }
        h1 { font-size: 22px; margin-bottom: 10px; }
        p { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 30px; }
        button { background: #3b82f6; color: #fff; border: none; border-radius: 10px; padding: 12px 32px; font-size: 15px; cursor: pointer; width: 100%; }
    </style>
</head>
<body>
    <div class="card">
        <span class="icon">📡</span>
        <h1>Offline Mode</h1>
        <p>This page hasn't been cached yet. Connect to the network to download it for offline use.</p>
        <button onclick="window.location.href='/quick'">Back to Dashboard</button>
    </div>
</body>
</html>`;

function fetchWithTimeout(request, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(request, { signal: controller.signal })
        .finally(() => clearTimeout(timer));
}

function shouldBypass(request, url) {
    if (request.method !== 'GET') return true;
    if (request.headers.has('range')) return true;
    if (url.origin !== self.location.origin) return true;
    if (url.pathname === '/rendler-industries.apk') return true;
    if (url.pathname === '/login') return true;
    if (url.pathname.startsWith('/auth/')) return true;
    if (url.pathname.startsWith('/audiobooks/api/cover/')) return false;
    if (url.pathname.startsWith('/files/serve/') && request.destination === 'image') return false;
    if (url.pathname.startsWith('/files/serve/')) return true;
    return false;
}

function cacheableResponse(response, request) {
    if (!response || !response.ok || response.redirected || response.type === 'opaqueredirect') return false;
    if (!request) return true;

    const url = new URL(request.url);
    const contentType = response.headers.get('content-type') || '';
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    const isImage = request.destination === 'image' || contentType.startsWith('image/');

    if (url.pathname.startsWith('/files/serve/') && !isImage) return false;
    if (isImage && contentLength > MAX_RUNTIME_IMAGE_BYTES) return false;

    return true;
}

function cacheResponse(request, response) {
    if (!cacheableResponse(response, request)) return Promise.resolve(false);
    return caches.open(CACHE_NAME)
        .then(cache => cache.put(request, response.clone()))
        .then(() => true)
        .catch(() => false);
}

function matchInOfflineCaches(request, options = {}) {
    return caches.keys().then(keys => {
        const offlineKeys = keys.filter(k => k.startsWith(OFFLINE_CACHE_PREFIX));
        const names = [
            CACHE_NAME,
            ...offlineKeys.filter(k => k !== CACHE_NAME).sort().reverse(),
        ];

        return names.reduce((promise, name) => {
            return promise.then(match => {
                if (match) return match;
                return caches.open(name).then(cache => cache.match(request, options));
            });
        }, Promise.resolve(null));
    });
}

function normalizePath(pathname) {
    return pathname.replace(/\/$/, '') || '/';
}

function matchCachedNavigation(request, url) {
    if (url.pathname === '/login') return Promise.resolve(null);

    const matchOpts = { ignoreSearch: true, ignoreVary: true };
    const normalized = normalizePath(url.pathname);

    return matchInOfflineCaches(request, matchOpts)
        .then(match => match || matchInOfflineCaches(normalized, matchOpts));
}

function navigationFallback(request, url) {
    const matchOpts = { ignoreSearch: true, ignoreVary: true };

    return matchCachedNavigation(request, url)
        .then(c => c || matchInOfflineCaches('/quick', matchOpts))
        .then(c => c || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html' } }));
}

function fetchAndCache(request, options = {}) {
    return fetch(request, options).then(response => {
        return cacheResponse(request, response).then(() => response);
    });
}

function fetchNavigation(request) {
    return fetchWithTimeout(request, NAVIGATION_NETWORK_TIMEOUT_MS).then(response => {
        return cacheResponse(request, response).then(() => response);
    });
}

function apiGetResponse(event) {
    const request = event.request;
    const matchOpts = { ignoreSearch: false, ignoreVary: true };

    return fetchWithTimeout(request, NAVIGATION_NETWORK_TIMEOUT_MS)
        .then(response => cacheResponse(request, response).then(() => response))
        .catch(() => matchInOfflineCaches(request, matchOpts));
}

function isApiGet(request, url) {
    return request.method === 'GET' && (url.pathname.startsWith('/api/') || url.pathname.includes('/api/'));
}

function shouldBypassApiGetCache(url) {
    return url.pathname === '/admin/automator/api/status'
        || url.pathname === '/admin/automator/api/state';
}

function cacheStatusResponse() {
    return caches.keys().then(keys => Promise.all(
        keys.filter(k => k.startsWith(OFFLINE_CACHE_PREFIX)).sort().reverse().map(name => {
            return caches.open(name).then(cache => cache.keys()).then(requests => ({
                name,
                urls: requests.map(r => new URL(r.url).pathname).sort(),
            }));
        })
    )).then(cacheInfo => {
        return new Response(JSON.stringify({
            cacheName: CACHE_NAME,
            caches: cacheInfo,
        }, null, 2), {
            headers: { 'Content-Type': 'application/json' },
        });
    });
}

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    const fallback = { title: 'Rendler Industries', body: 'New notification', url: '/quick' };
    let payload = fallback;
    if (event.data) {
        try {
            const raw = event.data.json();
            payload = {
                ...fallback,
                ...(raw.data || {}),
                ...(raw.notification || {}),
                ...raw,
            };
        } catch (e) {
            payload = { ...fallback, body: event.data.text() };
        }
    }

    event.waitUntil(
        self.registration.showNotification(payload.title || fallback.title, {
            body: payload.body || fallback.body,
            icon: '/images/pwa/icon-192.png',
            badge: '/images/pwa/icon-192.png',
            data: { url: payload.url || fallback.url },
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = new URL(event.notification.data?.url || '/quick', self.location.origin).href;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if ('focus' in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }
            return clients.openWindow(targetUrl);
        })
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (url.pathname === '/__sw_cache_status') {
        event.respondWith(cacheStatusResponse());
        return;
    }

    if (url.pathname.startsWith('/audiobooks/api/stream/')) return;
    if (url.pathname === '/audiobooks/api/state') return;

    if (shouldBypassApiGetCache(url)) return;

    if (isApiGet(event.request, url)) {
        event.respondWith(apiGetResponse(event));
        return;
    }

    if (event.request.mode === 'navigate') {
        event.respondWith(
            matchCachedNavigation(event.request, url).then(cached => {
                if (cached) {
                    event.waitUntil(fetchNavigation(event.request).catch(() => { }));
                    return cached;
                }

                return fetchNavigation(event.request)
                    .catch(() => navigationFallback(event.request, url));
            })
        );
        return;
    }

    if (shouldBypass(event.request, url)) return;

    const isAppCode = url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/');
    const isStatic = isAppCode ||
        url.pathname.startsWith('/fonts/') ||
        event.request.destination === 'image' ||
        url.pathname.endsWith('.ico');

    if (isStatic) {
        if (isAppCode) {
            event.respondWith(
                matchInOfflineCaches(event.request, { ignoreSearch: true, ignoreVary: true }).then(cached => {
                    if (cached) {
                        event.waitUntil(fetchAndCache(event.request, { cache: 'no-cache' }).catch(() => { }));
                        return cached;
                    }

                    return fetchAndCache(event.request, { cache: 'no-cache' })
                        .catch(() => cached);
                })
            );
            return;
        }

        event.respondWith(
            matchInOfflineCaches(event.request, { ignoreSearch: true, ignoreVary: true }).then(cached => {
                const fetchPromise = fetchAndCache(event.request).catch(() => cached);
                return cached || fetchPromise;
            })
        );
        return;
    }

    event.respondWith(
        fetchAndCache(event.request)
            .catch(() => matchInOfflineCaches(event.request, { ignoreSearch: true, ignoreVary: true }))
    );
});

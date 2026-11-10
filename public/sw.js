// /public/sw.js

/**
 * Service Worker for Offline and Cache Management
 *
 * Uses native connectivity for fresh online pages and app code, with cached
 * offline viewing and runtime image caching with size limits.
 * Serves an offline fallback HTML page when network is unavailable.
 *
 * Features:
 *   - Native-confirmed online refresh with cached offline fallback
 *   - Cache-first pages and app code without native connectivity support
 *   - Runtime image caching with 50MB size cap
 *   - Offline fallback HTML for uncached navigation requests
 *   - Preserves visited pages across cache versions
 */

const CACHE_NAME = 'rendler-offline-v153';
const MAX_RUNTIME_IMAGE_BYTES = 50 * 1024 * 1024;
const OFFLINE_CACHE_PREFIX = 'rendler-offline-';
const NAVIGATION_NETWORK_TIMEOUT_MS = 1500;
let nativeNetworkSupported = null;
let nativeNetworkRequest = null;
let lastCacheWriteFailure = null;

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

function fetchWithTimeout(request, timeoutMs, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(request, { ...options, signal: controller.signal })
        .finally(() => clearTimeout(timer));
}

function shouldBypass(request, url) {
    if (request.method !== 'GET') return true;
    if (request.headers.has('range')) return true;
    if (url.origin !== self.location.origin) return true;
    if (request.cache === 'no-store') return true;
    const path = normalizePath(url.pathname);
    if (path === '/__native_network_state') return true;
    if (path === '/rendler-industries.apk') return true;
    if (path === '/login') return true;
    if (path === '/auth' || path.startsWith('/auth/')) return true;
    if (path === '/admin/auth' || path.startsWith('/admin/auth/')) return true;
    if (path === '/cdn-cgi/access' || path.startsWith('/cdn-cgi/access/')) return true;
    if (path === '/trakt/oauth' || path.startsWith('/trakt/oauth/')) return true;
    if (shouldBypassApiGetCache(url)) return true;
    if (path === '/admin/automator') return true;
    if (path === '/audiobooks/api/state' || path.startsWith('/audiobooks/api/stream/')) return true;
    if (path.startsWith('/audiobooks/api/cover/')) return false;
    if (path.startsWith('/files/serve/') && request.mode === 'navigate') return true;
    if (path.startsWith('/files/serve/') && request.destination === 'image') return false;
    if (path.startsWith('/files/serve/')) return true;
    return false;
}

function cacheableResponse(response, request) {
    if (!response || !response.ok || response.redirected || response.type === 'opaqueredirect') return false;
    if (!request) return true;

    const url = new URL(request.url);
    if (shouldBypass(request, url)) return false;
    const contentType = response.headers.get('content-type') || '';
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    const isImage = request.destination === 'image' || contentType.startsWith('image/');

    if (url.pathname.startsWith('/files/serve/') && !isImage) return false;
    if (isImage && contentLength > MAX_RUNTIME_IMAGE_BYTES) return false;

    return true;
}

async function cacheResponse(request, response) {
    try {
        if (!cacheableResponse(response, request)) return false;
        // Clone before yielding, while the browser has not consumed the response.
        const cachedResponse = response.clone();
        const url = new URL(request.url);
        const contentType = response.headers.get('content-type') || '';
        if (isTraktState(url) || (isApiGet(request, url) && /(?:application\/json|\+json)(?:\s*;|$)/i.test(contentType))) {
            const data = await cachedResponse.clone().json();
            if (data?.success === 0 || data?.success === false || (data?.error && !data?.success)) return false;
            if (isTraktState(url) && (!data?.success || data.pending || data.refreshing || data.outdated)) return false;
        }
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, cachedResponse);
        return true;
    } catch (error) {
        lastCacheWriteFailure = { path: new URL(request.url).pathname, name: error?.name || 'Error', at: Date.now() };
        console.warn('Offline cache write failed:', lastCacheWriteFailure);
        return false;
    }
}

function matchInOfflineCaches(request, options = {}) {
    return caches.keys().then(keys => {
        const offlineKeys = keys.filter(k => k.startsWith(OFFLINE_CACHE_PREFIX));
        const names = [
            CACHE_NAME,
            ...offlineKeys.filter(k => k !== CACHE_NAME).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
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
    if (shouldBypass(request, url)) return Promise.resolve(null);

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

function nativeNetworkState() {
    if (nativeNetworkSupported === false) return Promise.resolve(null);
    if (nativeNetworkRequest) return nativeNetworkRequest;

    // The APK answers this locally, including on a cold offline launch.
    const request = new Request(new URL('/__native_network_state', self.location.origin), { cache: 'no-store' });
    nativeNetworkRequest = fetchWithTimeout(request, 300)
        .then(response => {
            const state = response.headers.get('X-Rendler-Network-State');
            nativeNetworkSupported = response.ok && (state === 'online' || state === 'offline');
            return nativeNetworkSupported ? state : null;
        })
        .catch(() => null)
        .finally(() => { nativeNetworkRequest = null; });
    return nativeNetworkRequest;
}

function freshAppResponse(event, fallback) {
    return fetchWithTimeout(event.request, NAVIGATION_NETWORK_TIMEOUT_MS, { cache: 'no-cache' })
        .then(response => {
            if (response.status >= 500) return fallback().then(cached => cached || response);
            event.waitUntil(cacheResponse(event.request, response));
            return response;
        })
        .catch(fallback);
}

function apiGetResponse(event) {
    const request = event.request;
    const matchOpts = { ignoreSearch: false, ignoreVary: true };
    const fallback = () => matchInOfflineCaches(request, matchOpts).then(cached => {
        return cached || new Response(JSON.stringify({
            success: 0,
            error: 'Network unavailable'
        }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    });

    if (isTraktState(new URL(request.url))) {
        return nativeNetworkState().then(state => {
            if (state === 'offline') return fallback();
            // Trakt's state reads retain their caller's longer timeout.
            return fetch(request).then(response => {
                event.waitUntil(cacheResponse(request, response));
                return response;
            }).catch(fallback);
        });
    }

    return fetchWithTimeout(request, NAVIGATION_NETWORK_TIMEOUT_MS)
        .then(response => cacheResponse(request, response).then(() => response))
        .catch(fallback);
}

function isApiGet(request, url) {
    return request.method === 'GET' && (url.pathname.startsWith('/api/') || url.pathname.includes('/api/'));
}

function isTraktState(url) {
    const path = normalizePath(url.pathname);
    return path === '/trakt/api/state' || path === '/trakt/api/unwatched';
}

function shouldBypassApiGetCache(url) {
    const path = normalizePath(url.pathname);
    return path === '/admin/settings/api/state'
        || path === '/admin/automator/api/status'
        || path === '/admin/automator/api/state'
        || ((path === '/trakt/api' || path.startsWith('/trakt/api/')) && !isTraktState(url));
}

function cacheStatusResponse() {
    return caches.keys().then(keys => Promise.all(
        keys.filter(k => k.startsWith(OFFLINE_CACHE_PREFIX)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map(name => {
            return caches.open(name).then(cache => cache.keys()).then(requests => ({
                name,
                urls: requests.map(r => new URL(r.url).pathname).sort(),
            }));
        })
    )).then(async cacheInfo => {
        let storage = null;
        try {
            storage = await self.navigator.storage.estimate();
        } catch (_) { }
        return new Response(JSON.stringify({
            cacheName: CACHE_NAME,
            caches: cacheInfo,
            storage,
            lastCacheWriteFailure,
        }, null, 2), {
            headers: { 'Content-Type': 'application/json' },
        });
    });
}

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    // A new cache version does not contain every previously visited page yet.
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

    if (shouldBypass(event.request, url)) {
        // Never cache login responses, but retain cached-origin cold offline boot.
        if (event.request.method === 'GET' && !event.request.headers.has('range') && event.request.cache !== 'no-store'
            && url.origin === self.location.origin && normalizePath(url.pathname) === '/login'
            && event.request.mode === 'navigate') {
            event.respondWith(nativeNetworkState().then(state => {
                if (state === 'offline') return navigationFallback(event.request, url);
                return fetchWithTimeout(event.request, NAVIGATION_NETWORK_TIMEOUT_MS, { cache: 'no-store' })
                    .catch(() => navigationFallback(event.request, url));
            }));
        }
        return;
    }

    if (url.pathname === '/__sw_cache_status') {
        event.respondWith(cacheStatusResponse());
        return;
    }

    if (isApiGet(event.request, url)) {
        event.respondWith(apiGetResponse(event));
        return;
    }

    if (event.request.mode === 'navigate') {
        event.respondWith(
            nativeNetworkState().then(state => {
                const fallback = () => navigationFallback(event.request, url);
                if (state === 'offline') return fallback();
                if (state === 'online') return freshAppResponse(event, fallback);

                return matchCachedNavigation(event.request, url).then(cached => {
                    if (cached) {
                        event.waitUntil(fetchNavigation(event.request).catch(() => { }));
                        return cached;
                    }

                    return fetchNavigation(event.request).catch(fallback);
                });
            })
        );
        return;
    }

    const isAppCode = url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/');
    const isStatic = isAppCode ||
        url.pathname.startsWith('/fonts/') ||
        event.request.destination === 'image' ||
        url.pathname.endsWith('.ico');

    if (isStatic) {
        if (isAppCode) {
            event.respondWith(
                nativeNetworkState().then(state => {
                    const fallback = () => matchInOfflineCaches(event.request, { ignoreSearch: true, ignoreVary: true });
                    if (state === 'offline') return fallback();
                    if (state === 'online') return freshAppResponse(event, fallback);

                    return fallback().then(cached => {
                        if (cached) {
                            event.waitUntil(fetchAndCache(event.request, { cache: 'no-cache' }).catch(() => { }));
                            return cached;
                        }

                        return fetchAndCache(event.request, { cache: 'no-cache' }).catch(() => cached);
                    });
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

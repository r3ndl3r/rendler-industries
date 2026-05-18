// /public/sw.js

const CACHE_NAME = 'rendler-offline-v56';
const MAX_RUNTIME_IMAGE_BYTES = 50 * 1024 * 1024;

const CORE_ASSETS = [
    '/',
    '/quick',
    '/brief',
    '/audiobooks',
    '/fuel',
    '/css/default.css',
    '/css/audiobooks.css',
    '/css/brief.css',
    '/css/calendar.css',
    '/css/emoji-picker.css',
    '/css/fuel.css',
    '/css/menubar.css',
    '/css/quick.css',
    '/css/index.css',
    '/js/jquery.js',
    '/js/toast.js',
    '/js/default.js',
    '/js/emoji-picker.js',
    '/js/fuel.js',
    '/js/menubar.js',
    '/js/audiobooks.js',
    '/js/brief.js',
    '/js/index.js',
    '/js/moment-lite.js',
    '/js/age.js',
    '/favicon.ico',
];

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
    if (url.pathname.includes('/api/')) return true;
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

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return Promise.allSettled(CORE_ASSETS.map(url => {
                return fetch(url).then(res => {
                    if (cacheableResponse(res)) return cache.put(url, res);
                }).catch(() => {});
            }));
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetchWithTimeout(event.request, 4000).then(response => {
                if (cacheableResponse(response, event.request)) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => {
                const matchOpts = { ignoreSearch: true, ignoreVary: true };
                const path = event.request.url.replace(/\/$/, "");
                const requestFallback = url.pathname === '/login'
                    ? Promise.resolve(null)
                    : caches.match(path, matchOpts).then(c => c || caches.match(event.request, matchOpts));

                return requestFallback
                    .then(c => c || caches.match('/quick', matchOpts))
                    .then(c => c || caches.match('/brief', matchOpts))
                    .then(c => c || caches.match('/audiobooks', matchOpts))
                    .then(c => c || caches.match('/', matchOpts))
                    .then(c => c || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html' } }));
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
                fetch(event.request, { cache: 'no-cache' }).then(response => {
                    if (cacheableResponse(response, event.request)) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                }).catch(() => caches.match(event.request, { ignoreSearch: true, ignoreVary: true }))
            );
            return;
        }

        event.respondWith(
            caches.match(event.request, { ignoreSearch: true, ignoreVary: true }).then(cached => {
                const fetchPromise = fetch(event.request).then(response => {
                    if (cacheableResponse(response, event.request)) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                }).catch(() => cached);
                return cached || fetchPromise;
            })
        );
        return;
    }

    event.respondWith(
        fetch(event.request).then(response => {
            if (cacheableResponse(response, event.request)) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return response;
        }).catch(() => caches.match(event.request, { ignoreSearch: true, ignoreVary: true }))
    );
});

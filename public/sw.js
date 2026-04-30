// ─── Version — bump this string on every release ──────────────────────────────
// Changing this value changes the cache names, which triggers the browser to
// install a new service worker and clean up the old caches on activate.
const CACHE_VERSION = '0.1.0';

const CACHE_HTML   = `sk-pages-${CACHE_VERSION}`;
const CACHE_STATIC = `sk-static-${CACHE_VERSION}`;
// RSC responses are NOT cached — they vary by Next-Router-State-Tree,
// Next-Router-Prefetch, and Next-Url.  Serving a stale RSC to the wrong
// router state silently corrupts navigation (the "Rendering…" symptom).
// Offline navigation falls back to the cached HTML shell instead.
const ALL_CACHES   = [CACHE_HTML, CACHE_STATIC];

const NAV_ROUTES = ['/', '/products', '/billing', '/bills', '/settings'];
const APP_SHELL  = [...NAV_ROUTES, '/manifest.webmanifest'];

// ─── Install: pre-cache HTML shells ───────────────────────────────────────────
// skipWaiting() is intentionally absent — the new worker waits until the
// client sends SKIP_WAITING (triggered by the user via the update toast).
// This prevents a mid-transaction reload on POS devices.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const htmlCache = await caches.open(CACHE_HTML);
    // Promise.allSettled: one failure cannot abort the whole install.
    await Promise.allSettled(
      APP_SHELL.map((url) =>
        fetch(url)
          .then((res) => { if (res.ok) htmlCache.put(url, res); })
          .catch(() => {}),
      ),
    );
  })());
});

// ─── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url          = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isNavigation = event.request.mode === 'navigate';

  // Skip webpack HMR, Next.js dev helpers, and the SW script itself.
  if (isSameOrigin && (
    url.pathname.startsWith('/_next/webpack-hmr') ||
    url.pathname.startsWith('/__nextjs_') ||
    url.pathname === '/sw.js'
  )) return;

  if (isNavigation) {
    event.respondWith(handleHtml(event));
    return;
  }

  if (!isSameOrigin) return;

  // RSC requests (navigation fetch or prefetch from Next.js App Router).
  const isRsc       = event.request.headers.get('RSC') === '1' || url.searchParams.has('_rsc');
  const isPrefetch  = event.request.headers.get('Next-Router-Prefetch') === '1';

  if (isRsc) {
    event.respondWith(handleRsc(event, url, isPrefetch));
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(handleStatic(event));
    return;
  }

  event.respondWith(handleGeneric(event));
});

// ─── Message: client-driven SW control ───────────────────────────────────────
// SKIP_WAITING: user accepted the update toast — take over immediately.
// WARM_CACHE:   push already-loaded chunk URLs into the static cache.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === 'WARM_CACHE') {
    const urls = Array.isArray(event.data.urls) ? event.data.urls : [];
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_STATIC);
      await Promise.allSettled(
        urls.map(async (url) => {
          if (await cache.match(url)) return;
          try {
            const res = await fetch(url);
            if (res.ok) cache.put(url, res);
          } catch { /* best-effort */ }
        }),
      );
    })());
  }
});

// ─── HTML pages: StaleWhileRevalidate ─────────────────────────────────────────
async function handleHtml(event) {
  const cache  = await caches.open(CACHE_HTML);
  // ignoreSearch: Next.js occasionally appends query params to navigation URLs.
  const cached = await cache.match(event.request, { ignoreSearch: true });

  const networkFetch = fetch(event.request)
    .then((res) => { if (res.ok) cache.put(event.request, res.clone()); return res; })
    .catch(() => null);

  if (cached) {
    event.waitUntil(networkFetch);
    return cached;
  }

  const networkRes = await networkFetch;
  if (networkRes) return networkRes;

  // Offline fallback: root shell boots the SPA so IndexedDB data still renders.
  return (await cache.match('/')) ??
    new Response('Offline — page not cached yet.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
}

// ─── RSC requests ─────────────────────────────────────────────────────────────
// Online: pass straight through to the network — no caching.
// Offline (navigation RSC only): signal the page to do a full navigation to the
// cached HTML shell for the target route, which boots the SPA from IndexedDB.
// Prefetch failures are ignored — Next.js handles them gracefully.
async function handleRsc(event, url, isPrefetch) {
  try {
    return await fetch(event.request);
  } catch {
    if (!isPrefetch) {
      try {
        const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const win of wins) {
          win.postMessage({ type: 'SK_OFFLINE_NAV', url: url.pathname });
        }
      } catch { /* best-effort */ }
    }
    return new Response('', { status: 503 });
  }
}

// ─── /_next/static/ assets ────────────────────────────────────────────────────
// CacheFirst for production content-hashed (immutable) chunks — filename changes
// on every build so a cached copy is always valid.
// NetworkFirst for everything else (dev chunks, CSS) — always fetch fresh so HMR
// works; fall back to the cached copy when offline so the app shell survives.
async function handleStatic(event) {
  const cache  = await caches.open(CACHE_STATIC);
  const cached = await cache.match(event.request);

  if (cached?.headers.get('Cache-Control')?.includes('immutable')) {
    return cached;
  }

  try {
    const res = await fetch(event.request);
    if (res.ok) cache.put(event.request, res.clone());
    return res;
  } catch {
    return cached ?? new Response('', { status: 503 });
  }
}

// ─── Generic same-origin assets (images, manifest, icons…) ───────────────────
async function handleGeneric(event) {
  const cache  = await caches.open(CACHE_HTML);
  const cached = await cache.match(event.request);
  if (cached) return cached;

  try {
    const res = await fetch(event.request);
    if (res.ok) cache.put(event.request, res.clone());
    return res;
  } catch {
    return new Response('', { status: 503 });
  }
}

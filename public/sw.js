// Version - bump this string on every release.
// Changing this value changes the cache names, which triggers the browser to
// install a new service worker and clean up the old caches on activate.
const DEV_HOST_RE =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/;
const IS_DEV_HOST =
  self.location.protocol === "http:" &&
  DEV_HOST_RE.test(self.location.hostname);
const ENABLE_DEV_SW =
  new URL(self.location.href).searchParams.get("dev-sw") === "1";

if (IS_DEV_HOST && !ENABLE_DEV_SW) {
  // A worker previously installed during local development can trap the phone
  // on stale Next.js chunks. Retire immediately and let all requests hit the
  // dev server directly.
  self.addEventListener("install", () => {
    self.skipWaiting();
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
        await self.clients.claim();

        const clients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        await Promise.all(clients.map((client) => client.navigate(client.url)));
        await self.registration.unregister();
      })(),
    );
  });
} else {
  const CACHE_VERSION = "0.1.10";

  const CACHE_HTML = `sk-pages-${CACHE_VERSION}`;
  const CACHE_STATIC = `sk-static-${CACHE_VERSION}`;
  const OFFLINE_FALLBACK_URL = "/__shopkeeper-offline-fallback__";
  // RSC responses are NOT cached. They vary by Next-Router-State-Tree,
  // Next-Router-Prefetch, and Next-Url. Serving a stale RSC to the wrong router
  // state silently corrupts navigation. Offline navigation falls back to cached
  // HTML document navigations instead.
  const ALL_CACHES = [CACHE_HTML, CACHE_STATIC];

  const NAV_ROUTES = [
    "/",
    "/products",
    "/inventory",
    "/reports",
    "/customers",
    "/suppliers",
    "/billing",
    "/bills",
    "/purchases/new",
    "/shift",
    "/settings",
  ];
  const APP_SHELL = [...NAV_ROUTES, "/manifest.webmanifest"];
  const FETCH_TIMEOUT_MS = 8000;

  self.addEventListener("install", (event) => {
    self.skipWaiting();

    // Do not block service-worker installation on route warm-up. On mobile
    // tunnels a single slow route can leave the worker stuck in "installing";
    // then Chrome shows its dinosaur page when the device goes offline. Install
    // only the local fallback immediately. Route HTML is warmed after activation
    // by the client via WARM_ROUTES.
    event.waitUntil(installCoreFallback());
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => !ALL_CACHES.includes(k))
            .map((k) => caches.delete(k)),
        );
        await self.clients.claim();
        await notifyWindows({ type: "SK_SW_ACTIVE", version: CACHE_VERSION });
      })(),
    );
  });

  self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;

    const url = new URL(event.request.url);
    const isSameOrigin = url.origin === self.location.origin;
    const isNavigation = event.request.mode === "navigate";

    if (
      isSameOrigin &&
      (url.pathname.startsWith("/_next/webpack-hmr") ||
        url.pathname.startsWith("/__nextjs_") ||
        url.pathname === "/sw.js")
    )
      return;

    if (isNavigation) {
      event.respondWith(handleHtml(event));
      return;
    }

    if (!isSameOrigin) return;

    const isRsc =
      event.request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
    const isPrefetch =
      event.request.headers.get("Next-Router-Prefetch") === "1";

    if (isRsc) {
      event.respondWith(handleRsc(event, url, isPrefetch));
      return;
    }

    if (url.pathname.startsWith("/_next/static/")) {
      event.respondWith(handleStatic(event));
      return;
    }

    event.respondWith(handleGeneric(event));
  });

  self.addEventListener("message", (event) => {
    if (event.data?.type === "SKIP_WAITING") {
      self.skipWaiting();
      return;
    }

    if (event.data?.type === "WARM_CACHE") {
      const urls = Array.isArray(event.data.urls) ? event.data.urls : [];
      event.waitUntil(warmStaticUrls(urls));
      return;
    }

    if (event.data?.type === "WARM_ROUTES") {
      const urls = Array.isArray(event.data.urls) ? event.data.urls : [];
      event.waitUntil(warmRouteHtml(urls));
      return;
    }

    if (event.data?.type === "SK_PING") {
      event.source?.postMessage?.({ type: "SK_PONG", version: CACHE_VERSION });
    }
  });

  async function installCoreFallback() {
    const cache = await caches.open(CACHE_HTML);
    await cache.put(OFFLINE_FALLBACK_URL, offlineRouteNotCachedResponse("/"));
  }

  async function handleHtml(event) {
    const cache = await caches.open(CACHE_HTML);
    const url = new URL(event.request.url);
    const routeKey = `${url.pathname}${url.search}`;

    const cacheHtml = (res) => {
      if (!res?.ok) return;
      event.waitUntil(
        (async () => {
          try {
            await cache.put(event.request, res.clone());
            await cache.put(routeKey, res.clone());
            if (res.headers.get("Content-Type")?.includes("text/html")) {
              const staticCache = await caches.open(CACHE_STATIC);
              await warmStaticAssetsFromHtml(res.clone(), staticCache);
            }
          } catch {
            // best-effort cache write
          }
        })(),
      );
    };

    // Online must be network-first. Returning stale HTML after a new Next build can
    // reference chunks that no longer exist and causes "This page could not load".
    try {
      const networkRes = await fetchWithTimeout(event.request);
      cacheHtml(networkRes.clone());
      return networkRes;
    } catch {
      // Offline fallback below.
    }

    const cached =
      (await cache.match(event.request, { ignoreSearch: true })) ||
      (await cache.match(routeKey, { ignoreSearch: true })) ||
      (await cache.match(url.pathname, { ignoreSearch: true }));
    if (cached) return cached;

    // Do not serve '/' for another route. In Next App Router that paints the
    // dashboard while the URL/sidebar say another page is active.
    return offlineRouteNotCachedResponse(url.pathname);
  }

  async function handleRsc(event, url, isPrefetch) {
    try {
      return await fetchWithTimeout(event.request);
    } catch {
      if (!isPrefetch) {
        await notifyWindows({
          type: "SK_OFFLINE_NAV",
          url: `${url.pathname}${url.search}`,
        });
      }
      return new Response("", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  async function handleStatic(event) {
    const cache = await caches.open(CACHE_STATIC);
    const cached = await cache.match(event.request);
    if (cached) return cached;

    try {
      const res = await fetchWithTimeout(event.request);
      if (res.ok) await cache.put(event.request, res.clone());
      return res;
    } catch {
      return new Response("", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  async function warmRouteHtml(urls) {
    const htmlCache = await caches.open(CACHE_HTML);
    const staticCache = await caches.open(CACHE_STATIC);

    await Promise.allSettled(
      urls.map(async (rawUrl) => {
        try {
          const url = new URL(rawUrl, self.location.origin);
          if (url.origin !== self.location.origin) return;
          const routeKey = `${url.pathname}${url.search}`;
          const res = await fetchWithTimeout(
            routeKey,
            { cache: "reload" },
            FETCH_TIMEOUT_MS,
          );
          if (!res.ok) return;
          await htmlCache.put(routeKey, res.clone());
          await htmlCache.put(url.toString(), res.clone());
          if (res.headers.get("Content-Type")?.includes("text/html")) {
            await warmStaticAssetsFromHtml(res.clone(), staticCache);
          }
        } catch {
          // best-effort warm-up
        }
      }),
    );

    await notifyWindows({ type: "SK_CACHE_WARMED", version: CACHE_VERSION });
  }

  async function warmStaticUrls(urls) {
    const cache = await caches.open(CACHE_STATIC);
    await Promise.allSettled(
      urls.map(async (rawUrl) => {
        try {
          const url = new URL(rawUrl, self.location.origin);
          if (url.origin !== self.location.origin) return;
          if (!url.pathname.startsWith("/_next/static/")) return;
          if (await cache.match(url.toString())) return;
          const res = await fetchWithTimeout(url.toString());
          if (res.ok) await cache.put(url.toString(), res.clone());
        } catch {
          // best-effort
        }
      }),
    );
  }

  async function warmStaticAssetsFromHtml(response, cache) {
    try {
      const html = await response.text();
      const urls = new Set();

      const attrRe = /(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/g;
      const stringRe = /["']([^"']*\/_next\/static\/[^"']+)["']/g;
      let match;
      while ((match = attrRe.exec(html))) {
        urls.add(new URL(match[1], self.location.origin).toString());
      }
      while ((match = stringRe.exec(html))) {
        urls.add(new URL(match[1], self.location.origin).toString());
      }

      await warmStaticUrls(Array.from(urls));
    } catch {
      // best-effort asset warming
    }
  }

  async function handleGeneric(event) {
    const cache = await caches.open(CACHE_STATIC);
    const cached = await cache.match(event.request);
    if (cached) return cached;

    try {
      const res = await fetchWithTimeout(event.request);
      if (res.ok) await cache.put(event.request, res.clone());
      return res;
    } catch {
      return new Response("", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  async function fetchWithTimeout(
    input,
    init = {},
    timeoutMs = FETCH_TIMEOUT_MS,
  ) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Fetch timed out")), timeoutMs);
    });
    try {
      return await Promise.race([fetch(input, init), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function notifyWindows(message) {
    try {
      const wins = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      await Promise.all(wins.map((win) => win.postMessage(message)));
    } catch {
      // best-effort
    }
  }

  function offlineRouteNotCachedResponse(pathname) {
    return new Response(
      `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Offline cache not ready</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e2e8f0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px}
    main{max-width:460px;background:rgba(15,23,42,.9);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:24px;box-shadow:0 18px 60px rgba(0,0,0,.35)}
    h1{font-size:20px;margin:0 0 8px;color:#fff}p{line-height:1.5;margin:8px 0;color:#cbd5e1}.path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#93c5fd}button{margin-top:14px;border:0;border-radius:12px;background:#2563eb;color:#fff;font-weight:700;padding:10px 14px}
  </style>
</head>
<body>
  <main>
    <h1>Offline cache is not ready yet.</h1>
    <p>The device is offline and <span class="path">${escapeHtml(pathname)}</span> was not prepared in the offline cache.</p>
    <p>Reconnect once, keep this tab open until the app says the offline cache is ready, then test offline again.</p>
    <button onclick="location.reload()">Retry</button>
  </main>
</body>
</html>`,
      {
        status: 503,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { db } from '@/lib/db/schema';
import { useLocale } from '@/components/providers/locale-context';

const OFFLINE_NAV_ROUTES = [
  '/', '/products', '/inventory', '/reports', '/customers', '/billing', '/bills', '/settings', '/admin/users',
] as const;

// These are the routes the store must have offline. Admin is intentionally not
// required because many devices are normal cashier devices and may not have
// permission to cache it.
const REQUIRED_OFFLINE_ROUTES = ['/', '/products', '/billing', '/bills', '/settings'] as const;
const OFFLINE_NAV_ROUTE_SET = new Set<string>(OFFLINE_NAV_ROUTES);
const FIRST_CONTROL_RELOAD_KEY = 'shopkeeper_sw_first_control_reload_v3';

function sameOriginRouteFromHref(href: string): string | null {
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    if (!OFFLINE_NAV_ROUTE_SET.has(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function collectLoadedStaticAssets(): string[] {
  const scriptUrls = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]')).map((s) => s.src);
  const linkUrls = Array.from(document.querySelectorAll<HTMLLinkElement>('link[href]')).map((l) => l.href);
  return [...scriptUrls, ...linkUrls].filter((url) => url.includes('/_next/static/'));
}

function hardNavigateTo(route: string): void {
  try {
    const url = new URL(route, window.location.origin);
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  } catch {
    window.location.assign(route);
  }
}

function requestOfflineCacheWarm(reg: ServiceWorkerRegistration | null | undefined): void {
  const worker = reg?.active ?? navigator.serviceWorker.controller;
  if (!worker) return;

  const staticUrls = collectLoadedStaticAssets();
  if (staticUrls.length > 0) {
    worker.postMessage({ type: 'WARM_CACHE', urls: staticUrls });
  }
  worker.postMessage({ type: 'WARM_ROUTES', urls: OFFLINE_NAV_ROUTES });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function isRouteCached(route: string): Promise<boolean> {
  if (!('caches' in window)) return false;
  const absolute = new URL(route, window.location.origin).toString();
  return Boolean(
    (await caches.match(absolute, { ignoreSearch: true })) ||
    (await caches.match(route, { ignoreSearch: true })),
  );
}

async function hasRequiredOfflineCache(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  if (!navigator.serviceWorker.controller) return false;
  if (!('caches' in window)) return false;

  const results = await Promise.all(REQUIRED_OFFLINE_ROUTES.map((route) => isRouteCached(route)));
  return results.every(Boolean);
}

export function ServiceWorkerRegister() {
  const { t } = useLocale();
  const regRef = useRef<ServiceWorkerRegistration | null>(null);
  const warmRunRef = useRef(0);

  // undefined = not yet measured (avoids hydration mismatch and the false
  // "Online" flash that occurred when the layout remounted after a hard reload).
  const [online, setOnline] = useState<boolean | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [cacheUnavailable, setCacheUnavailable] = useState(false);

  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function refreshPendingCount() {
      try {
        const count = await db.syncQueue.where('status').anyOf(['pending', 'failed', 'syncing']).count();
        if (!cancelled) setPendingCount(count);
      } catch {
        if (!cancelled) setPendingCount(0);
      }
    }

    void refreshPendingCount();
    const id = window.setInterval(refreshPendingCount, 3000);
    window.addEventListener('online', refreshPendingCount);
    window.addEventListener('offline', refreshPendingCount);
    window.addEventListener('shopkeeper:sync-requested', refreshPendingCount);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('online', refreshPendingCount);
      window.removeEventListener('offline', refreshPendingCount);
      window.removeEventListener('shopkeeper:sync-requested', refreshPendingCount);
    };
  }, []);

  useEffect(() => {
    const enableDevSw = process.env.NEXT_PUBLIC_ENABLE_OFFLINE_SW === '1';
    let onSwMessage: ((e: MessageEvent) => void) | null = null;
    let cancelled = false;

    setOnline(window.navigator.onLine);
    setInstalled(window.matchMedia('(display-mode: standalone)').matches);

    function reloadOnceForControl(): boolean {
      if (navigator.serviceWorker.controller) return false;
      if (sessionStorage.getItem(FIRST_CONTROL_RELOAD_KEY) === '1') return false;
      sessionStorage.setItem(FIRST_CONTROL_RELOAD_KEY, '1');
      window.location.reload();
      return true;
    }

    async function warmWhenReady() {
      if (!('serviceWorker' in navigator)) return;
      const runId = ++warmRunRef.current;

      try {
        setCacheUnavailable(false);
        setReady(false);
        const reg = await navigator.serviceWorker.ready;
        if (cancelled || runId !== warmRunRef.current) return;
        regRef.current = reg;

        // On a fresh Cloudflare hostname the first page load is often not yet
        // controlled by the newly installed worker. Force one online reload so
        // the next offline reload is handled by the service worker, not Chrome.
        if (!navigator.serviceWorker.controller) {
          if (reloadOnceForControl()) return;
        }

        requestOfflineCacheWarm(reg);
        for (let attempt = 0; attempt < 8; attempt += 1) {
          await delay(attempt === 0 ? 600 : 1200);
          if (cancelled || runId !== warmRunRef.current) return;
          if (await hasRequiredOfflineCache()) {
            setReady(true);
            setCacheUnavailable(false);
            return;
          }
          if (attempt === 2 || attempt === 5) {
            requestOfflineCacheWarm(reg);
          }
        }

        // Keep showing "Preparing offline cache" instead of claiming readiness.
        setReady(false);
        setCacheUnavailable(false);
      } catch (err) {
        if (!cancelled) {
          setReady(true);
          setCacheUnavailable(true);
          console.warn('[sw] Offline cache preparation failed:', err);
        }
      }
    }

    function onOnline() {
      setOnline(true);
      void warmWhenReady();
    }
    function onOffline() { setOnline(false); }
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);

    // Next App Router client navigation needs RSC data from the network. When
    // the device is offline, use a full document navigation so the service
    // worker can serve the cached HTML for that exact route instead of leaving
    // the URL/sidebar on the new route while the old page remains visible.
    function handleOfflineRouteClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (window.navigator.onLine) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.target) return;
      const route = sameOriginRouteFromHref(anchor.href);
      if (!route) return;
      event.preventDefault();
      hardNavigateTo(route);
    }
    document.addEventListener('click', handleOfflineRouteClick, true);

    // Skip service-worker registration in development unless explicitly enabled
    // for offline testing. A normal dev worker can serve stale Next.js chunks
    // after every dev-server restart.
    if (!('serviceWorker' in navigator)) {
      setReady(true);
      setCacheUnavailable(true);
    } else if (process.env.NODE_ENV !== 'production' && !enableDevSw) {
      setReady(true);
      setCacheUnavailable(true);
      const reloadKey = 'shopkeeper_dev_sw_cleanup_reloaded';
      const cleanupDevWorker = async () => {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((reg) => reg.unregister()));

          let deletedCache = false;
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(
              keys
                .filter((key) => key.startsWith('sk-'))
                .map(async (key) => {
                  deletedCache = (await caches.delete(key)) || deletedCache;
                }),
            );
          }

          const wasControlled = Boolean(navigator.serviceWorker.controller);
          const removedWorker = registrations.length > 0;
          const alreadyReloaded = sessionStorage.getItem(reloadKey) === '1';

          if ((wasControlled || removedWorker || deletedCache) && !alreadyReloaded) {
            sessionStorage.setItem(reloadKey, '1');
            window.location.reload();
            return;
          }

          if (!wasControlled && !removedWorker && !deletedCache) {
            sessionStorage.removeItem(reloadKey);
          }
        } catch (err) {
          console.warn('[sw] Development service-worker cleanup failed:', err);
        }
      };

      cleanupDevWorker();
    } else {
      const swUrl = process.env.NODE_ENV === 'production' ? '/sw.js' : '/sw.js?dev-sw=1';

      const onControllerChange = () => {
        // First install: reload once to become definitely controlled. Later
        // updates are handled by the explicit "update available" button.
        if (!sessionStorage.getItem(FIRST_CONTROL_RELOAD_KEY)) {
          sessionStorage.setItem(FIRST_CONTROL_RELOAD_KEY, '1');
          window.location.reload();
          return;
        }
        void warmWhenReady();
      };
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

      navigator.serviceWorker.register(swUrl)
        .then((reg) => {
          regRef.current = reg;
          setCacheUnavailable(false);

          if (reg.waiting && navigator.serviceWorker.controller) {
            setUpdateAvailable(true);
          }

          reg.addEventListener('updatefound', () => {
            const next = reg.installing;
            if (!next) return;
            next.addEventListener('statechange', () => {
              if (next.state === 'installed' && navigator.serviceWorker.controller) {
                regRef.current = reg;
                setUpdateAvailable(true);
              }
            });
          });

          void warmWhenReady();
        })
        .catch((err) => {
          setReady(true);
          setCacheUnavailable(true);
          console.error('SW registration failed', err);
        });

      // When the SW cannot serve RSC from network while offline/unreachable it
      // sends this message. Do NOT depend on navigator.onLine here: phones and
      // captive/LAN connections can report "online" even when the app origin is
      // unreachable. Always fall back to a full document navigation.
      onSwMessage = (e: MessageEvent) => {
        if (e.data?.type === 'SK_OFFLINE_NAV') {
          const route = typeof e.data.url === 'string' ? e.data.url : window.location.pathname;
          hardNavigateTo(route);
        }
        if (e.data?.type === 'SK_SW_ACTIVE') {
          void warmWhenReady();
        }
        if (e.data?.type === 'SK_CACHE_WARMED') {
          void hasRequiredOfflineCache().then((ok) => {
            if (!cancelled) setReady(ok);
          });
        }
      };
      navigator.serviceWorker.addEventListener('message', onSwMessage);

      return () => {
        cancelled = true;
        window.removeEventListener('online',  onOnline);
        window.removeEventListener('offline', onOffline);
        document.removeEventListener('click', handleOfflineRouteClick, true);
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        if (onSwMessage) {
          navigator.serviceWorker.removeEventListener('message', onSwMessage);
        }
      };
    }

    return () => {
      cancelled = true;
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('click', handleOfflineRouteClick, true);
      if (onSwMessage && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onSwMessage);
      }
    };
  }, []);

  function handleUpdate() {
    const reg = regRef.current;
    if (!reg?.waiting) return;
    // Tell the waiting SW to activate now; page reloads on controllerchange.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    }, { once: true });
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  const networkBadge = online === undefined ? null : (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
      online ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
    }`}>
      {online ? t('pwa.online') : t('pwa.offline')}
    </span>
  );

  return (
    <div className="flex flex-wrap gap-2 px-4 py-2 bg-slate-950 border-b border-white/5" aria-live="polite">
      {networkBadge}
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/5 text-slate-400">
        {cacheUnavailable ? t('pwa.cacheUnavailable') : ready ? t('pwa.cacheReady') : t('pwa.cachePrep')}
      </span>
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/5 text-slate-400">
        {installed ? t('pwa.installed') : t('pwa.installable')}
      </span>

      {pendingCount > 0 && (
        <span title={t('sync.waitingCloud')} className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-900/40 text-blue-300">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          {t('sync.pendingBadge', { count: pendingCount })}
        </span>
      )}

      {updateAvailable && (
        <button
          type="button"
          onClick={handleUpdate}
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          {t('pwa.updateAvailable')} - {t('pwa.reload')}
        </button>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { db } from '@/lib/db/schema';
import { useLocale } from '@/components/providers/locale-context';

export function ServiceWorkerRegister() {
  const { t } = useLocale();
  const regRef = useRef<ServiceWorkerRegistration | null>(null);

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

    setOnline(window.navigator.onLine);
    setInstalled(window.matchMedia('(display-mode: standalone)').matches);

    function onOnline()  { setOnline(true); }
    function onOffline() { setOnline(false); }
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);

    // Skip service-worker registration in development — the dev server changes
    // chunk hashes on every restart, and a registered SW will keep serving the
    // old cached JS, making code changes invisible on repeat visits.
    if (!('serviceWorker' in navigator)) {
      setReady(true);
      setCacheUnavailable(true);
    } else if (process.env.NODE_ENV !== 'production' && !enableDevSw) {
      // Dev cleanup: an already-installed SW can keep serving stale Next.js
      // chunks after every dev-server restart. Remove it and its app caches.
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

      navigator.serviceWorker.register(swUrl)
        .then((reg) => {
          setReady(true);
          setCacheUnavailable(false);
          regRef.current = reg;

          // Detect a waiting SW that arrived before this page load
          // (e.g. user refreshed after a deploy).
          if (reg.waiting && navigator.serviceWorker.controller) {
            setUpdateAvailable(true);
          }

          // Detect a new SW that finishes installing while the page is open.
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
        })
        .catch((err) => {
          setReady(true);
          setCacheUnavailable(true);
          console.error('SW registration failed', err);
        });

      // Once the SW is active, push all loaded /_next/static/ chunks into its
      // cache so other routes can hydrate offline even before the user visits them.
      navigator.serviceWorker.ready.then((reg) => {
        if (!reg.active) return;
        const urls = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))
          .map((s) => s.src)
          .filter((s) => s.includes('/_next/static/'));
        if (urls.length) reg.active.postMessage({ type: 'WARM_CACHE', urls });
      });

      // When the SW can't serve RSC from cache while offline it sends this
      // message so we fall back to a full-page navigation.  The SW will then
      // serve the cached HTML shell and the app boots from IndexedDB.
      function onSwMessage(e: MessageEvent) {
        if (e.data?.type === 'SK_OFFLINE_NAV' && !navigator.onLine) {
          window.location.href = e.data.url as string;
        }
      }
      navigator.serviceWorker.addEventListener('message', onSwMessage);
    }

    return () => {
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
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
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-900/40 text-blue-300">
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
          {t('pwa.updateAvailable')} — {t('pwa.reload')}
        </button>
      )}
    </div>
  );
}

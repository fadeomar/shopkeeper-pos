'use client';

import { useEffect, useRef, useState } from 'react';
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

  useEffect(() => {
    setOnline(window.navigator.onLine);
    setInstalled(window.matchMedia('(display-mode: standalone)').matches);

    function onOnline()  { setOnline(true); }
    function onOffline() { setOnline(false); }
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          setReady(true);
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
        .catch((err) => console.error('SW registration failed', err));

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
        {ready ? t('pwa.cacheReady') : t('pwa.cachePrep')}
      </span>
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/5 text-slate-400">
        {installed ? t('pwa.installed') : t('pwa.installable')}
      </span>

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

'use client';

import { useEffect, useState } from 'react';
import { getDirection, getT, type Locale } from '@/lib/i18n';

const LOCALE_KEY = 'shopkeeper-pos-locale';

async function clearOfflineCaches() {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith('sk-')).map((key) => caches.delete(key)));
}

// global-error renders OUTSIDE LocaleProvider (it owns its own <html>/<body>),
// so we can't useLocale() here. We read the persisted locale from localStorage
// directly so the catastrophic-failure screen still respects the user's choice.
function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem(LOCALE_KEY);
    return stored === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [locale, setLocale] = useState<Locale>('en');
  useEffect(() => {
    console.error('[global-error]', error);
    setLocale(readStoredLocale());
  }, [error]);

  const t = getT(locale);
  const dir = getDirection(locale);

  async function hardReload() {
    try {
      await clearOfflineCaches();
    } finally {
      window.location.reload();
    }
  }

  return (
    <html lang={locale} dir={dir}>
      <body style={{ margin: 0, background: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
          <section style={{ maxWidth: 420, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 24, padding: 24, textAlign: 'center' }}>
            <h1 style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>{t('errorPage.globalTitle')}</h1>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.5 }}>{t('errorPage.globalDesc')}</p>
            <button onClick={reset} style={{ width: '100%', padding: 12, borderRadius: 12, border: 0, background: '#2563eb', color: '#fff', fontWeight: 700 }}>{t('errorPage.tryAgain')}</button>
            <button onClick={hardReload} style={{ width: '100%', padding: 12, borderRadius: 12, border: 0, marginTop: 8, background: '#e2e8f0', color: '#334155', fontWeight: 700 }}>{t('errorPage.clearAndReload')}</button>
          </section>
        </main>
      </body>
    </html>
  );
}

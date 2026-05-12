'use client';

import { useEffect } from 'react';

async function clearOfflineCaches() {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith('sk-')).map((key) => caches.delete(key)));
}

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[global-error]', error);
  }, [error]);

  async function hardReload() {
    try {
      await clearOfflineCaches();
    } finally {
      window.location.reload();
    }
  }

  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
          <section style={{ maxWidth: 420, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 24, padding: 24, textAlign: 'center' }}>
            <h1 style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>Shopkeeper POS could not load</h1>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.5 }}>
              Your local data is still safe. Try again, or clear the offline cache and reload.
            </p>
            <button onClick={reset} style={{ width: '100%', padding: 12, borderRadius: 12, border: 0, background: '#2563eb', color: '#fff', fontWeight: 700 }}>Try again</button>
            <button onClick={hardReload} style={{ width: '100%', padding: 12, borderRadius: 12, border: 0, marginTop: 8, background: '#e2e8f0', color: '#334155', fontWeight: 700 }}>Clear cache & reload</button>
          </section>
        </main>
      </body>
    </html>
  );
}

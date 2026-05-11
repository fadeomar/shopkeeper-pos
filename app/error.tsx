'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

async function clearOfflineCaches() {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith('sk-')).map((key) => caches.delete(key)));
}

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    console.error('[app-error]', error);
  }, [error]);

  const details = [
    `Message: ${error.message}`,
    error.digest ? `Digest: ${error.digest}` : '',
    `Path: ${typeof window !== 'undefined' ? window.location.pathname : 'unknown'}`,
    `Online: ${typeof navigator !== 'undefined' ? navigator.onLine : 'unknown'}`,
    `Time: ${new Date().toISOString()}`,
  ].filter(Boolean).join('\n');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function handleHardReload() {
    try {
      await clearOfflineCaches();
    } finally {
      window.location.reload();
    }
  }

  return (
    <main className="min-h-[70vh] flex items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
          <span className="text-xl font-bold">!</span>
        </div>
        <h1 className="text-center text-lg font-bold text-slate-900">This page could not load</h1>
        <p className="mt-2 text-center text-sm text-slate-500">
          Your local data is still safe on this device. Try again first. If the issue remains, clear the offline cache and reload.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button type="button" onClick={reset}>Try again</Button>
          <Button type="button" variant="secondary" onClick={handleHardReload}>Clear cache & reload</Button>
          <Button type="button" variant="ghost" onClick={handleCopy}>{copied ? 'Copied' : 'Copy error details'}</Button>
        </div>
        <pre className="mt-4 max-h-32 overflow-auto rounded-2xl bg-slate-50 p-3 text-xs text-slate-500 whitespace-pre-wrap break-words">
          {details}
        </pre>
      </section>
    </main>
  );
}

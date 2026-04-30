'use client';

import { useEffect, useState } from 'react';
import { settingsRepo } from '@/lib/db/repositories';
import { useSettings } from './settings-context';
import { useLocale } from './locale-context';

export function DbBootstrap({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setSettings } = useSettings();
  const { t } = useLocale();

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;

    const timeout = setTimeout(() => {
      if (!cancelled) setError(t('db.timeoutError'));
    }, 5_000);

    void (async () => {
      try {
        const s = await settingsRepo.init();
        if (!cancelled) { clearTimeout(timeout); setSettings(s); setReady(true); }
      } catch (err) {
        if (!cancelled) {
          clearTimeout(timeout);
          setError(err instanceof Error ? err.message : t('db.initError'));
        }
      }
    })();

    return () => { cancelled = true; clearTimeout(timeout); };
  }, [mounted, setSettings, t]);

  if (!mounted) return null;

  if (error) {
    return (
      <div className="m-6 p-5 bg-white border border-red-200 rounded-2xl shadow-xs">
        <p className="font-semibold text-red-600 mb-2">{t('db.storageError')}</p>
        <p className="text-sm text-slate-700 mb-1">{error}</p>
        <p className="text-sm text-slate-500">{t('db.storageErrorDesc')}</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="m-6 p-5 bg-white border border-slate-200 rounded-2xl shadow-xs">
        <p className="text-sm text-slate-500">{t('db.loading')}</p>
      </div>
    );
  }

  return <>{children}</>;
}

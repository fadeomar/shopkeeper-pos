'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLiveQuery } from 'dexie-react-hooks';
import { settingsRepo } from '@/lib/db/repositories';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useLocale } from '@/components/providers/locale-context';
import { useAuth } from '@/components/providers/auth-context';
import { syncAllToCloud, syncSettingsToCloud, type SyncMeta } from '@/lib/firebase/sync-service';
import type { Locale } from '@/lib/i18n';
import clsx from 'clsx';

interface SettingsFormValues {
  storeName: string;
  cashierName: string;
  currency: string;
  allowLossSale: boolean;
  lowStockHighlight: boolean;
}

export default function SettingsPage() {
  const { t, locale, setLocale } = useLocale();
  const { user } = useAuth();
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const { push } = useToast();

  const form = useForm<SettingsFormValues>({
    defaultValues: {
      storeName: '', cashierName: '', currency: 'USD',
      allowLossSale: false, lowStockHighlight: true,
    },
  });

  useEffect(() => {
    if (!settings) return;
    form.reset({
      storeName: settings.storeName,
      cashierName: settings.cashierName || '',
      currency: settings.currency,
      allowLossSale: settings.allowLossSale,
      lowStockHighlight: settings.lowStockHighlight,
    });
  }, [settings, form]);

  async function onSubmit(values: SettingsFormValues) {
    const saved = await settingsRepo.update(values);
    push(t('settings.saved'));
    // Best-effort cloud sync — local save already succeeded
    if (user?.uid) void syncSettingsToCloud(user.uid, saved).catch(() => {});
  }

  const languages: { value: Locale; label: string }[] = [
    { value: 'en', label: t('settings.english') },
    { value: 'ar', label: t('settings.arabic') },
  ];

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="text-xl font-bold text-slate-900">{t('settings.title')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('settings.subtitle')}</p>
      </section>

      {/* Language switcher */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-700 mb-1">{t('settings.language')}</h3>
        <p className="text-xs text-slate-500 mb-4">{t('settings.languageDesc')}</p>
        <div className="flex flex-wrap gap-2">
          {languages.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setLocale(value)}
              className={clsx(
                'px-5 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all duration-150',
                locale === value
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      {/* Store settings form */}
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card className="flex flex-col gap-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">{t('settings.storeName')}</span>
              <Input {...form.register('storeName')} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">{t('settings.cashierName')}</span>
              <Input {...form.register('cashierName')} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">{t('settings.currency')}</span>
              <Input {...form.register('currency')} />
            </label>
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded accent-blue-600"
                {...form.register('allowLossSale')}
              />
              <span className="text-sm font-medium text-slate-700">{t('settings.allowLossSale')}</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded accent-blue-600"
                {...form.register('lowStockHighlight')}
              />
              <span className="text-sm font-medium text-slate-700">{t('settings.lowStockHighlight')}</span>
            </label>
          </div>

          <div className="flex justify-end pt-1">
            <Button type="submit">{t('settings.save')}</Button>
          </div>
        </Card>
      </form>

      {/* Cloud Backup */}
      <CloudBackupCard />

      {/* About */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">{t('settings.about')}</h3>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">{t('settings.version')}</span>
          <span className="text-sm font-mono font-medium text-slate-700">
            v{process.env.NEXT_PUBLIC_APP_VERSION ?? '—'}
          </span>
        </div>
      </Card>
    </div>
  );
}

function CloudBackupCard() {
  const { user } = useAuth();
  const { push } = useToast();
  const uid = user?.uid;
  const [syncing, setSyncing]   = useState(false);
  const [syncMeta, setSyncMeta] = useState<SyncMeta | null>(null);

  // Load last sync info from localStorage (no Firestore read needed)
  useEffect(() => {
    if (!uid) return;
    try {
      const stored = localStorage.getItem(`shopkeeper_last_sync_${uid}`);
      if (stored) setSyncMeta(JSON.parse(stored) as SyncMeta);
    } catch { /* ignore */ }
  }, [uid]);

  async function handleSync() {
    if (!uid) return;
    setSyncing(true);
    try {
      const result = await syncAllToCloud(uid);
      if (result) {
        setSyncMeta(result);
        push('Synced to cloud successfully ✓');
      } else {
        push('Sync failed — check your connection.');
      }
    } finally {
      setSyncing(false);
    }
  }

  const lastSyncDisplay = syncMeta
    ? new Date(syncMeta.lastSyncedAt).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null;

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-1">Cloud Backup</h3>
          <p className="text-xs text-slate-500 max-w-xs">
            Back up your local data to the cloud. Used to restore on a new device.
            Auto-syncs daily while online.
          </p>
        </div>
        <Button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="shrink-0"
        >
          {syncing ? 'Syncing…' : 'Sync Now'}
        </Button>
      </div>

      {syncMeta ? (
        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SyncStat label="Last synced" value={lastSyncDisplay ?? '—'} wide />
          <SyncStat label="Bills"       value={syncMeta.recordCounts.bills} />
          <SyncStat label="Products"    value={syncMeta.recordCounts.products} />
          <SyncStat label="Movements"   value={syncMeta.recordCounts.stockMovements} />
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-400">Never synced on this device.</p>
      )}
    </Card>
  );
}

function SyncStat({ label, value, wide }: { label: string; value: string | number; wide?: boolean }) {
  return (
    <div className={clsx('flex flex-col gap-0.5', wide && 'col-span-2 sm:col-span-1')}>
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-700 tabular-nums">{value}</span>
    </div>
  );
}

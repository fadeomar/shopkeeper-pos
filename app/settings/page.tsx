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
import { useSettings } from '@/components/providers/settings-context';
import { syncAllToCloud, type SyncMeta } from '@/lib/firebase/sync-service';
import { runSync } from '@/components/providers/sync-provider';
import { getOpenConflicts } from '@/lib/services/sync-conflict-service';
import { enqueueSyncJob, getPendingSyncCount, getSyncQueueCounts, retryFailedSyncJobs } from '@/lib/services/sync-queue-service';
import type { Locale } from '@/lib/i18n';
import { db } from '@/lib/db/schema';
import { createLocalBackupSnapshot, downloadJsonFile } from '@/lib/utils/backup';
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
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const { setSettings } = useSettings();
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
    const saved = await settingsRepo.update({
      ...values,
      syncStatus: 'pending',
      lastSyncError: undefined,
    });
    setSettings(saved);
    await enqueueSyncJob({ entity: 'settings', entityId: saved.id, operation: 'upsert' });
    push(t('settings.saved'));
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

      {/* Device health / release safety */}
      <DeviceHealthCard />

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
  const { t } = useLocale();
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
      await retryFailedSyncJobs();
      await runSync(uid);

      const [pendingCount, openConflicts] = await Promise.all([
        getPendingSyncCount(),
        getOpenConflicts(),
      ]);

      if (openConflicts.length > 0) {
        push('Resolve the open conflict first, then sync again.', 'error');
        return;
      }

      if (pendingCount > 0) {
        window.dispatchEvent(new Event('shopkeeper:sync-requested'));
        push(`${pendingCount} change(s) are still waiting to sync. Try again after the sync badge becomes green.`, 'error');
        return;
      }

      const result = await syncAllToCloud(uid);
      if (result) {
        setSyncMeta(result);
        push(t('settings.syncSuccess'));
      } else {
        push(t('settings.syncFailed'), 'error');
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
          <h3 className="text-sm font-semibold text-slate-700 mb-1">{t('settings.cloudBackup')}</h3>
          <p className="text-xs text-slate-500 max-w-xs">
            {t('settings.cloudBackupDesc')}
          </p>
        </div>
        <Button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="shrink-0"
        >
          {syncing ? t('sync.syncing') : t('settings.syncNow')}
        </Button>
      </div>

      {syncMeta ? (
        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SyncStat label={t('settings.lastSynced')} value={lastSyncDisplay ?? '—'} wide />
          <SyncStat label={t('settings.bills')}       value={syncMeta.recordCounts.bills} />
          <SyncStat label={t('settings.products')}    value={syncMeta.recordCounts.products} />
          <SyncStat label={t('settings.movements')}   value={syncMeta.recordCounts.stockMovements} />
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-400">{t('settings.neverSynced')}</p>
      )}
    </Card>
  );
}



function DeviceHealthCard() {
  const { t } = useLocale();
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [stats, setStats] = useState<{
    products: number;
    bills: number;
    billItems: number;
    stockMovements: number;
    customerPayments: number;
    pending: number;
    syncing: number;
    failed: number;
    conflict: number;
    synced: number;
  } | null>(null);

  async function refreshHealth() {
    setLoading(true);
    try {
      const [products, bills, billItems, stockMovements, customerPayments, queue] = await Promise.all([
        db.products.count(),
        db.bills.count(),
        db.billItems.count(),
        db.stockMovements.count(),
        db.customerPayments.count(),
        getSyncQueueCounts(),
      ]);
      setStats({ products, bills, billItems, stockMovements, customerPayments, ...queue });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshHealth();
    const id = window.setInterval(refreshHealth, 5000);
    window.addEventListener('online', refreshHealth);
    window.addEventListener('shopkeeper:sync-requested', refreshHealth);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', refreshHealth);
      window.removeEventListener('shopkeeper:sync-requested', refreshHealth);
    };
  }, []);

  async function handleRetryFailed() {
    setRepairing(true);
    try {
      const count = await retryFailedSyncJobs();
      await refreshHealth();
      push(count > 0 ? t('settings.retrySyncQueued') : t('settings.noFailedSyncJobs'));
    } finally {
      setRepairing(false);
    }
  }

  async function handleExportBackup() {
    setExporting(true);
    try {
      const snapshot = await createLocalBackupSnapshot();
      const stamp = snapshot.exportedAt.replace(/[:.]/g, '-');
      downloadJsonFile(`shopkeeper-local-backup-${stamp}.json`, snapshot);
      push(t('settings.localBackupExported'));
    } catch {
      push(t('settings.localBackupFailed'), 'error');
    } finally {
      setExporting(false);
    }
  }

  async function handleClearCaches() {
    const browserWindow = window as Window & typeof globalThis;
    if (!browserWindow.caches) {
      browserWindow.location.reload();
      return;
    }
    try {
      const keys = await browserWindow.caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('sk-')).map((key) => browserWindow.caches.delete(key)));
      push(t('settings.cacheCleared'));
    } finally {
      browserWindow.location.reload();
    }
  }

  const waiting = stats ? stats.pending + stats.syncing + stats.failed + stats.conflict : 0;

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-1">{t('settings.deviceHealth')}</h3>
          <p className="text-xs text-slate-500 max-w-xl">{t('settings.deviceHealthDesc')}</p>
        </div>
        <Button type="button" variant="secondary" onClick={refreshHealth} disabled={loading} className="shrink-0">
          {loading ? t('common.loading') : t('settings.refreshHealth')}
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SyncStat label={t('settings.products')} value={stats?.products ?? '—'} />
        <SyncStat label={t('settings.bills')} value={stats?.bills ?? '—'} />
        <SyncStat label={t('settings.movements')} value={stats?.stockMovements ?? '—'} />
        <SyncStat label={t('settings.pendingSync')} value={waiting} />
      </div>

      <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
        {stats?.failed ? (
          <span className="font-medium text-red-600">{t('settings.failedSyncWarning', { count: stats.failed })}</span>
        ) : waiting > 0 ? (
          <span className="font-medium text-blue-700">{t('settings.waitingSyncWarning', { count: waiting })}</span>
        ) : (
          <span className="font-medium text-emerald-700">{t('settings.healthLooksGood')}</span>
        )}
      </div>

      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <Button type="button" variant="secondary" onClick={handleExportBackup} disabled={exporting}>
          {exporting ? t('settings.exportingBackup') : t('settings.exportLocalBackup')}
        </Button>
        <Button type="button" variant="secondary" onClick={handleRetryFailed} disabled={repairing}>
          {repairing ? t('sync.syncing') : t('settings.retryFailedSync')}
        </Button>
        <Button type="button" variant="secondary" onClick={handleClearCaches}>
          {t('settings.clearCacheReload')}
        </Button>
      </div>
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

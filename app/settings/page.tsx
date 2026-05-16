"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useLiveQuery } from "dexie-react-hooks";
import { settingsRepo } from "@/lib/db/repositories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form-field";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import { Toolbar } from "@/components/ui/toolbar";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import { useAuth } from "@/components/providers/auth-context";
import { useSettings } from "@/components/providers/settings-context";
import { syncAllToCloud, type SyncMeta } from "@/lib/firebase/sync-service";
import { runSync } from "@/components/providers/sync-provider";
import { getOpenConflicts } from "@/lib/services/sync-conflict-service";
import {
  enqueueSyncJob,
  getPendingSyncCount,
  getSyncQueueCounts,
  retryFailedSyncJobs,
} from "@/lib/services/sync-queue-service";
import type { Locale } from "@/lib/i18n";
import { db } from "@/lib/db/schema";
import {
  createLocalBackupSnapshot,
  downloadJsonFile,
} from "@/lib/utils/backup";
import {
  actionRowClasses,
  alertTones,
  dividerClasses,
  panelTones,
  typographyClasses,
} from "@/lib/design/variants";
import clsx from "clsx";

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
      storeName: "",
      cashierName: "",
      currency: "USD",
      allowLossSale: false,
      lowStockHighlight: true,
    },
  });

  useEffect(() => {
    if (!settings) return;
    form.reset({
      storeName: settings.storeName,
      cashierName: settings.cashierName || "",
      currency: settings.currency,
      allowLossSale: settings.allowLossSale,
      lowStockHighlight: settings.lowStockHighlight,
    });
  }, [settings, form]);

  async function onSubmit(values: SettingsFormValues) {
    // Normalize and validate the currency code so it can be safely passed to
    // Intl.NumberFormat across the app. Free-text values like "us" or "$"
    // would throw inside formatCurrency on any view that renders money.
    const normalizedCurrency = (values.currency ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      push(t("settings.invalidCurrency"), "error");
      return;
    }
    const saved = await settingsRepo.update({
      ...values,
      currency: normalizedCurrency,
      syncStatus: "pending",
      lastSyncError: undefined,
    });
    setSettings(saved);
    await enqueueSyncJob({
      entity: "settings",
      entityId: saved.id,
      operation: "upsert",
    });
    push(t("settings.saved"));
  }

  const languages: { value: Locale; label: string }[] = [
    { value: "en", label: t("settings.english") },
    { value: "ar", label: t("settings.arabic") },
  ];

  return (
    <PageShell>
      <PageHeader
        title={t("settings.title")}
        description={t("settings.subtitle")}
      />

      <SectionCard
        title={t("settings.language")}
        description={t("settings.languageDesc")}
      >
        <Toolbar align="start">
          {languages.map(({ value, label }) => {
            const isActive = locale === value;
            return (
              <Button
                key={value}
                type="button"
                variant={isActive ? "primary" : "outline"}
                size="sm"
                onClick={() => setLocale(value)}
                aria-pressed={isActive}
              >
                {label}
              </Button>
            );
          })}
        </Toolbar>
      </SectionCard>

      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SectionCard
          title={t("settings.storeName")}
          description={t("settings.subtitle")}
          actions={<Button type="submit">{t("settings.save")}</Button>}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label={t("settings.storeName")}>
              <Input {...form.register("storeName")} />
            </FormField>
            <FormField label={t("settings.cashierName")}>
              <Input {...form.register("cashierName")} />
            </FormField>
            <FormField label={t("settings.currency")} className="sm:max-w-xs">
              <Input {...form.register("currency")} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SettingToggleRow
              label={t("settings.allowLossSale")}
              inputProps={form.register("allowLossSale")}
            />
            <SettingToggleRow
              label={t("settings.lowStockHighlight")}
              inputProps={form.register("lowStockHighlight")}
            />
          </div>
        </SectionCard>
      </form>

      <CloudBackupCard />
      <DeviceHealthCard />

      <SectionCard title={t("settings.about")}>
        <div className="flex items-center justify-between gap-3">
          <span className={typographyClasses.bodyMuted}>
            {t("settings.version")}
          </span>
          <Badge tone="neutral" size="md" className="font-mono">
            v{process.env.NEXT_PUBLIC_APP_VERSION ?? "—"}
          </Badge>
        </div>
      </SectionCard>
    </PageShell>
  );
}

function SettingToggleRow({
  label,
  inputProps,
}: {
  label: string;
  inputProps: ReturnType<
    ReturnType<typeof useForm<SettingsFormValues>>["register"]
  >;
}) {
  return (
    <label
      className={clsx(
        "flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border p-4",
        panelTones.neutral,
      )}
    >
      <input
        type="checkbox"
        className="size-4 rounded border-slate-300 accent-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        {...inputProps}
      />
      <span className={typographyClasses.label}>{label}</span>
    </label>
  );
}

function CloudBackupCard() {
  const { user } = useAuth();
  const { push } = useToast();
  const { t } = useLocale();
  const uid = user?.uid;
  const [syncing, setSyncing] = useState(false);
  const [syncMeta, setSyncMeta] = useState<SyncMeta | null>(null);

  // Load last sync info from localStorage (no Firestore read needed)
  useEffect(() => {
    if (!uid) return;
    try {
      const stored = localStorage.getItem(`shopkeeper_last_sync_${uid}`);
      if (stored) setSyncMeta(JSON.parse(stored) as SyncMeta);
    } catch {
      /* ignore */
    }
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
        push("Resolve the open conflict first, then sync again.", "error");
        return;
      }

      if (pendingCount > 0) {
        window.dispatchEvent(new Event("shopkeeper:sync-requested"));
        push(
          `${pendingCount} change(s) are still waiting to sync. Try again after the sync badge becomes green.`,
          "error",
        );
        return;
      }

      const result = await syncAllToCloud(uid);
      if (result) {
        setSyncMeta(result);
        push(t("settings.syncSuccess"));
      } else {
        push(t("settings.syncFailed"), "error");
      }
    } finally {
      setSyncing(false);
    }
  }

  const lastSyncDisplay = syncMeta
    ? new Date(syncMeta.lastSyncedAt).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <SectionCard
      title={t("settings.cloudBackup")}
      description={t("settings.cloudBackupDesc")}
      actions={
        <Button
          type="button"
          onClick={handleSync}
          loading={syncing}
          disabled={!uid}
        >
          {syncing ? t("sync.syncing") : t("settings.syncNow")}
        </Button>
      }
    >
      <Toolbar align="start">
        <StatusPill
          status={uid ? "online" : "offline"}
          label={uid ? t("pwa.online") : t("pwa.offline")}
        />
        {syncMeta ? (
          <StatusPill status="synced" label={t("sync.synced")} />
        ) : (
          <StatusPill status="pendingSync" label={t("settings.neverSynced")} />
        )}
      </Toolbar>

      {syncMeta ? (
        <div
          className={clsx(
            "grid grid-cols-2 gap-3 border-t pt-4 sm:grid-cols-4",
            dividerClasses.borderSubtle,
          )}
        >
          <SyncStat
            label={t("settings.lastSynced")}
            value={lastSyncDisplay ?? "—"}
            wide
          />
          <SyncStat
            label={t("settings.bills")}
            value={syncMeta.recordCounts.bills}
          />
          <SyncStat
            label={t("settings.products")}
            value={syncMeta.recordCounts.products}
          />
          <SyncStat
            label={t("settings.movements")}
            value={syncMeta.recordCounts.stockMovements}
          />
        </div>
      ) : (
        <p className={typographyClasses.hint}>{t("settings.neverSynced")}</p>
      )}
    </SectionCard>
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
    blocked: number;
    synced: number;
  } | null>(null);

  async function refreshHealth() {
    setLoading(true);
    try {
      const [
        products,
        bills,
        billItems,
        stockMovements,
        customerPayments,
        queue,
      ] = await Promise.all([
        db.products.count(),
        db.bills.count(),
        db.billItems.count(),
        db.stockMovements.count(),
        db.customerPayments.count(),
        getSyncQueueCounts(),
      ]);
      setStats({
        products,
        bills,
        billItems,
        stockMovements,
        customerPayments,
        ...queue,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshHealth();
    const id = window.setInterval(refreshHealth, 5000);
    window.addEventListener("online", refreshHealth);
    window.addEventListener("shopkeeper:sync-requested", refreshHealth);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("online", refreshHealth);
      window.removeEventListener("shopkeeper:sync-requested", refreshHealth);
    };
  }, []);

  async function handleRetryFailed() {
    setRepairing(true);
    try {
      const count = await retryFailedSyncJobs();
      await refreshHealth();
      push(
        count > 0
          ? t("settings.retrySyncQueued")
          : t("settings.noFailedSyncJobs"),
      );
    } finally {
      setRepairing(false);
    }
  }

  async function handleExportBackup() {
    setExporting(true);
    try {
      const snapshot = await createLocalBackupSnapshot();
      const stamp = snapshot.exportedAt.replace(/[:.]/g, "-");
      downloadJsonFile(`shopkeeper-local-backup-${stamp}.json`, snapshot);
      push(t("settings.localBackupExported"));
    } catch {
      push(t("settings.localBackupFailed"), "error");
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
      await Promise.all(
        keys
          .filter((key) => key.startsWith("sk-"))
          .map((key) => browserWindow.caches.delete(key)),
      );
      push(t("settings.cacheCleared"));
    } finally {
      browserWindow.location.reload();
    }
  }

  const waiting = stats
    ? stats.pending +
      stats.syncing +
      stats.failed +
      stats.conflict +
      stats.blocked
    : 0;
  const blocked = stats?.blocked ?? 0;
  const failed = stats?.failed ?? 0;
  const healthTone =
    blocked > 0 || failed > 0 ? "danger" : waiting > 0 ? "info" : "success";

  return (
    <>
      <SectionCard
        title={t("settings.deviceHealth")}
        description={t("settings.deviceHealthDesc")}
        actions={
          <Button
            type="button"
            variant="secondary"
            onClick={refreshHealth}
            loading={loading}
          >
            {loading ? t("common.loading") : t("settings.refreshHealth")}
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SyncStat
            label={t("settings.products")}
            value={stats?.products ?? "—"}
          />
          <SyncStat label={t("settings.bills")} value={stats?.bills ?? "—"} />
          <SyncStat
            label={t("settings.movements")}
            value={stats?.stockMovements ?? "—"}
          />
          <SyncStat label={t("settings.pendingSync")} value={waiting} />
        </div>

        <div
          className={clsx(
            "rounded-2xl border p-3 text-xs",
            alertTones[healthTone],
          )}
        >
          {blocked > 0 ? (
            <span className="font-medium">
              {t("settings.blockedSyncWarning", { count: blocked })}
            </span>
          ) : failed > 0 ? (
            <span className="font-medium">
              {t("settings.failedSyncWarning", { count: failed })}
            </span>
          ) : waiting > 0 ? (
            <span className="font-medium">
              {t("settings.waitingSyncWarning", { count: waiting })}
            </span>
          ) : (
            <span className="font-medium">{t("settings.healthLooksGood")}</span>
          )}
        </div>

        <Toolbar align="start">
          <StatusPill
            status={waiting > 0 ? "pendingSync" : "synced"}
            label={waiting > 0 ? t("settings.pendingSync") : t("sync.synced")}
          />
          {failed > 0 && <StatusPill status="error" label={t("sync.failed")} />}
          {blocked > 0 && (
            <StatusPill status="conflict" label={t("sync.blocked")} />
          )}
        </Toolbar>
      </SectionCard>

      <SectionCard
        title={t("settings.exportLocalBackup")}
        description={t("settings.deviceHealthDesc")}
      >
        <div className={actionRowClasses.default}>
          <Button
            type="button"
            variant="secondary"
            onClick={handleExportBackup}
            loading={exporting}
          >
            {exporting
              ? t("settings.exportingBackup")
              : t("settings.exportLocalBackup")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleRetryFailed}
            loading={repairing}
          >
            {repairing ? t("sync.syncing") : t("settings.retryFailedSync")}
          </Button>
          <Button type="button" variant="outline" onClick={handleClearCaches}>
            {t("settings.clearCacheReload")}
          </Button>
        </div>
      </SectionCard>
    </>
  );
}

function SyncStat({
  label,
  value,
  wide,
}: {
  label: string;
  value: string | number;
  wide?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-2xl border p-3",
        panelTones.neutral,
        wide && "col-span-2 sm:col-span-1",
      )}
    >
      <span className={typographyClasses.hint}>{label}</span>
      <span className="mt-1 block text-sm font-semibold tabular-nums text-slate-800">
        {value}
      </span>
    </div>
  );
}

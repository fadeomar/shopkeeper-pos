"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useLiveQuery } from "dexie-react-hooks";
import { settingsRepo } from "@/lib/db/repositories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberFieldRHF } from "@/components/ui/number-field-rhf";
import { MoneyInputRHF } from "@/components/ui/money-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Settings as SettingsIcon } from "lucide-react";
import { FormField } from "@/components/ui/form-field";
import { Card } from "@/components/ui/card";
import { SectionCard } from "@/components/ui/section-card";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import { useAuth } from "@/components/providers/auth-context";
import { useSettings } from "@/components/providers/settings-context";
import { syncAllToCloud, type SyncMeta } from "@/lib/firebase/sync-service";
import { runSync } from "@/components/providers/sync-provider";
import { getOpenConflicts } from "@/lib/services/sync-conflict-service";
import {
  getPendingSyncCount,
  getSyncQueueCounts,
  retryFailedSyncJobs,
} from "@/lib/services/sync-queue-service";
import {
  saveBusinessSettings,
  saveRolePermissions,
} from "@/lib/services/settings-service";
import { getServiceErrorMessage } from "@/lib/errors/get-error-message";
import type { Locale } from "@/lib/i18n";
import type { UserRole, RolePermissions } from "@/types/domain";
import { DEFAULT_ROLE_PERMISSIONS } from "@/types/domain";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { db } from "@/lib/db/schema";
import {
  createLocalBackupSnapshot,
  downloadJsonFile,
} from "@/lib/utils/backup";
import clsx from "clsx";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";

// ─── Form types ──────────────────────────────────────────────────────────────

interface SettingsFormValues {
  // Business profile
  storeName: string;
  businessAddress: string;
  businessPhone: string;
  cashierName: string;
  // POS
  currency: string;
  taxMode: "none" | "inclusive" | "exclusive";
  defaultDiscountLimit: number;
  allowLossSale: boolean;
  requireShift: boolean;
  // Payment methods
  enableCash: boolean;
  enableCard: boolean;
  enableCredit: boolean;
  // Receipt
  receiptHeader: string;
  receiptFooter: string;
  // Inventory alerts
  lowStockHighlight: boolean;
  lowStockThreshold: number;
  expiryWarningDays: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded accent-brand"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </span>
    </label>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { t, locale, setLocale } = useLocale();
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const { setSettings } = useSettings();
  const { push } = useToast();
  const { canManageSettings, canManageRolePermissions } = usePermissions();

  const form = useForm<SettingsFormValues>({
    defaultValues: {
      storeName: "",
      businessAddress: "",
      businessPhone: "",
      cashierName: "",
      currency: "ILS",
      taxMode: "none",
      defaultDiscountLimit: 0,
      allowLossSale: false,
      requireShift: false,
      enableCash: true,
      enableCard: true,
      enableCredit: true,
      receiptHeader: "",
      receiptFooter: "",
      lowStockHighlight: true,
      lowStockThreshold: 5,
      expiryWarningDays: 30,
    },
  });

  useEffect(() => {
    if (!settings) return;
    form.reset({
      storeName: settings.storeName,
      businessAddress: settings.businessAddress ?? "",
      businessPhone: settings.businessPhone ?? "",
      cashierName: settings.cashierName ?? "",
      currency: settings.currency,
      taxMode: settings.taxMode ?? "none",
      defaultDiscountLimit: settings.defaultDiscountLimit ?? 0,
      allowLossSale: settings.allowLossSale,
      requireShift: settings.requireShift ?? false,
      enableCash: settings.enableCash !== false,
      enableCard: settings.enableCard !== false,
      enableCredit: settings.enableCredit !== false,
      receiptHeader: settings.receiptHeader ?? "",
      receiptFooter: settings.receiptFooter ?? "",
      lowStockHighlight: settings.lowStockHighlight,
      lowStockThreshold: settings.lowStockThreshold ?? 5,
      expiryWarningDays: settings.expiryWarningDays ?? 30,
    });
  }, [settings, form]);

  async function onSubmit(values: SettingsFormValues) {
    if (!canManageSettings) {
      push(t("errors.PERMISSION_DENIED"), "error");
      return;
    }
    const normalizedCurrency = (values.currency ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      push(t("settings.invalidCurrency"), "error");
      return;
    }
    // At least one payment method must stay enabled — otherwise the POS would
    // have no valid method and the service would reject every sale. (The POS
    // falls back to cash visually, but the service treats cash as disabled too,
    // so block the all-off state here at the source.)
    if (!values.enableCash && !values.enableCard && !values.enableCredit) {
      push(t("settings.atLeastOnePaymentMethod"), "error");
      return;
    }
    try {
      const saved = await saveBusinessSettings({
        ...values,
        currency: normalizedCurrency,
      });
      setSettings(saved);
      push(t("settings.saved"));
    } catch (error) {
      push(
        getServiceErrorMessage(error, t, t("errors.PERMISSION_DENIED")),
        "error",
      );
    }
  }

  const languages: { value: Locale; label: string }[] = [
    { value: "en", label: t("settings.english") },
    { value: "ar", label: t("settings.arabic") },
  ];

  const taxOptions = [
    { value: "none", label: t("settings.taxModeNone") },
    { value: "inclusive", label: t("settings.taxModeInclusive") },
    { value: "exclusive", label: t("settings.taxModeExclusive") },
  ];

  // Currency is a dropdown of common regional + major codes (ILS first for the
  // local market) rather than free text, so cashiers can't save a typo'd code.
  // Any pre-existing value not in the list is preserved as its own option.
  const currencyValue = form.watch("currency");
  const COMMON_CURRENCIES = [
    { value: "ILS", label: "ILS — ₪ Israeli New Shekel" },
    { value: "JOD", label: "JOD — Jordanian Dinar" },
    { value: "USD", label: "USD — $ US Dollar" },
    { value: "EUR", label: "EUR — € Euro" },
    { value: "EGP", label: "EGP — Egyptian Pound" },
    { value: "SAR", label: "SAR — Saudi Riyal" },
    { value: "AED", label: "AED — UAE Dirham" },
    { value: "GBP", label: "GBP — £ British Pound" },
  ];
  const currencyOptions =
    currencyValue && !COMMON_CURRENCIES.some((c) => c.value === currencyValue)
      ? [{ value: currencyValue, label: currencyValue }, ...COMMON_CURRENCIES]
      : COMMON_CURRENCIES;

  const watchEnable = {
    cash: form.watch("enableCash"),
    card: form.watch("enableCard"),
    credit: form.watch("enableCredit"),
  };

  return (
    <PageShell>
      <PageHeader
        title={t("settings.title")}
        description={t("settings.subtitle")}
        icon={<SettingsIcon size={24} aria-hidden />}
      />

      {/* ── Language ─────────────────────────────────────────────────────── */}
      <SectionCard
        title={t("settings.language")}
        description={t("settings.languageDesc")}
      >
        <div className="flex flex-wrap gap-2">
          {languages.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setLocale(value)}
              className={clsx(
                "px-5 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all duration-150",
                locale === value
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </SectionCard>

      {/* ── Main settings form ───────────────────────────────────────────── */}
      {canManageSettings ? (
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-5"
        >
          {/* Business profile */}
          <SectionCard
            title={t("settings.businessProfile")}
            description={t("settings.businessProfileDesc")}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label={t("settings.storeName")}>
                <Input {...form.register("storeName")} />
              </FormField>
              <FormField label={t("settings.cashierName")}>
                <Input {...form.register("cashierName")} />
              </FormField>
              <FormField label={t("settings.businessAddress")}>
                <Input {...form.register("businessAddress")} />
              </FormField>
              <FormField label={t("settings.businessPhone")}>
                <Input {...form.register("businessPhone")} type="tel" />
              </FormField>
            </div>
          </SectionCard>

          {/* Point of Sale */}
          <SectionCard
            title={t("settings.posSettings")}
            description={t("settings.posSettingsDesc")}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <FormField
                label={t("settings.currency")}
                hint={t("settings.currencyHint")}
              >
                <SearchableSelect
                  value={currencyValue}
                  onValueChange={(value) =>
                    form.setValue("currency", (value ?? "ILS").toUpperCase(), {
                      shouldDirty: true,
                    })
                  }
                  options={currencyOptions}
                  searchPlaceholder={t("settings.currency")}
                />
              </FormField>

              <FormField label={t("settings.taxMode")}>
                <SearchableSelect
                  value={form.watch("taxMode")}
                  onValueChange={(value) =>
                    form.setValue(
                      "taxMode",
                      (value ?? "none") as "none" | "inclusive" | "exclusive",
                      { shouldDirty: true },
                    )
                  }
                  options={taxOptions}
                />
              </FormField>

              <FormField
                label={t("settings.defaultDiscountLimit")}
                hint={t("settings.defaultDiscountLimitHint")}
              >
                <MoneyInputRHF
                  name="defaultDiscountLimit"
                  control={form.control}
                  currency={form.watch("currency") || "ILS"}
                  min={0}
                />
              </FormField>
            </div>

            <div className="flex flex-col gap-3">
              <ToggleRow
                label={t("settings.allowLossSale")}
                checked={form.watch("allowLossSale")}
                onChange={(v) => form.setValue("allowLossSale", v)}
              />
              <ToggleRow
                label={t("settings.requireShift")}
                checked={form.watch("requireShift")}
                onChange={(v) => form.setValue("requireShift", v)}
              />
            </div>
          </SectionCard>

          {/* Payment methods */}
          <SectionCard
            title={t("settings.paymentMethods")}
            description={t("settings.paymentMethodsDesc")}
          >
            <div className="flex flex-col gap-3">
              <ToggleRow
                label={t("settings.enableCash")}
                checked={watchEnable.cash}
                onChange={(v) => form.setValue("enableCash", v)}
              />
              <ToggleRow
                label={t("settings.enableCard")}
                checked={watchEnable.card}
                onChange={(v) => form.setValue("enableCard", v)}
              />
              <ToggleRow
                label={t("settings.enableCredit")}
                checked={watchEnable.credit}
                onChange={(v) => form.setValue("enableCredit", v)}
              />
            </div>
          </SectionCard>

          {/* Receipt */}
          <SectionCard
            title={t("settings.receiptSettings")}
            description={t("settings.receiptSettingsDesc")}
          >
            <div className="flex flex-col gap-4">
              <FormField
                label={t("settings.receiptHeader")}
                hint={t("settings.receiptHeaderHint")}
              >
                <Input {...form.register("receiptHeader")} />
              </FormField>
              <FormField
                label={t("settings.receiptFooter")}
                hint={t("settings.receiptFooterHint")}
              >
                <Input {...form.register("receiptFooter")} />
              </FormField>
            </div>
          </SectionCard>

          {/* Inventory alerts */}
          <SectionCard
            title={t("settings.inventoryAlerts")}
            description={t("settings.inventoryAlertsDesc")}
          >
            <div className="mb-4">
              <ToggleRow
                label={t("settings.lowStockHighlight")}
                checked={form.watch("lowStockHighlight")}
                onChange={(v) => form.setValue("lowStockHighlight", v)}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                label={t("settings.lowStockThreshold")}
                hint={t("settings.lowStockThresholdHint")}
              >
                <NumberFieldRHF
                  name="lowStockThreshold"
                  control={form.control}
                  precision="integer"
                  min={0}
                />
              </FormField>
              <FormField
                label={t("settings.expiryWarningDays")}
                hint={t("settings.expiryWarningDaysHint")}
              >
                <NumberFieldRHF
                  name="expiryWarningDays"
                  control={form.control}
                  precision="integer"
                  min={0}
                />
              </FormField>
            </div>
          </SectionCard>

          <div className="flex justify-end">
            <Button type="submit">{t("settings.save")}</Button>
          </div>
        </form>
      ) : (
        <SectionCard
          title={t("settings.posSettings")}
          description={t("settings.posSettingsDesc")}
        >
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 text-sm text-slate-500">
            {t("admin.onlyAdminsManage")}
          </div>
        </SectionCard>
      )}

      {/* ── Role permissions ─────────────────────────────────────────────── */}
      {canManageRolePermissions && <RolePermissionsCard />}

      {/* ── Cloud Backup ─────────────────────────────────────────────────── */}
      <CloudBackupCard />

      {/* ── Device health ────────────────────────────────────────────────── */}
      <DeviceHealthCard />

      {/* ── About ────────────────────────────────────────────────────────── */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">
          {t("settings.about")}
        </h3>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            {t("settings.version")}
          </span>
          <span className="text-sm font-mono font-medium text-slate-700">
            v{process.env.NEXT_PUBLIC_APP_VERSION ?? "—"}
          </span>
        </div>
      </Card>
    </PageShell>
  );
}

// ─── Role Permissions Card ───────────────────────────────────────────────────

const ROLES: UserRole[] = ["owner", "manager", "cashier", "accountant"];
const PERM_KEYS: Array<keyof RolePermissions> = [
  "canVoid",
  "canReturn",
  "canDiscount",
  "canViewProfit",
  "canEditCost",
  "canExport",
];

type PermOverride = Partial<Record<UserRole, Partial<RolePermissions>>>;

function RolePermissionsCard() {
  const { t } = useLocale();
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const { setSettings } = useSettings();
  const { push } = useToast();
  const [saving, setSaving] = useState(false);
  const [overrides, setOverrides] = useState<PermOverride>({});
  const { canManageRolePermissions } = usePermissions();

  useEffect(() => {
    if (!settings) return;
    setOverrides(settings.rolePermissions ?? {});
  }, [settings]);

  function getEffective(role: UserRole, perm: keyof RolePermissions): boolean {
    const base = DEFAULT_ROLE_PERMISSIONS[role][perm];
    return overrides[role]?.[perm] ?? base;
  }

  function toggle(role: UserRole, perm: keyof RolePermissions) {
    if (!canManageRolePermissions) return;
    if (role === "owner") return; // owner always has full access
    const current = getEffective(role, perm);
    setOverrides((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        [perm]: !current,
      },
    }));
  }

  function resetToDefaults() {
    if (!canManageRolePermissions) return;
    setOverrides({});
  }

  async function save() {
    if (!canManageRolePermissions) {
      push(t("errors.PERMISSION_DENIED"), "error");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveRolePermissions(overrides);
      setSettings(saved);
      push(t("settings.permissionsSaved"));
    } catch (error) {
      push(
        getServiceErrorMessage(error, t, t("errors.PERMISSION_DENIED")),
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  const roleLabels: Record<UserRole, string> = {
    owner: t("settings.roleOwner"),
    manager: t("settings.roleManager"),
    cashier: t("settings.roleCashier"),
    accountant: t("settings.roleAccountant"),
  };

  const permLabels: Record<keyof RolePermissions, string> = {
    canVoid: t("settings.permCanVoid"),
    canReturn: t("settings.permCanReturn"),
    canDiscount: t("settings.permCanDiscount"),
    canViewProfit: t("settings.permCanViewProfit"),
    canEditCost: t("settings.permCanEditCost"),
    canExport: t("settings.permCanExport"),
    canManageSettings: t("settings.permCanManageSettings"),
    canManageRolePermissions: t("settings.permCanManageRolePermissions"),
  };

  return (
    <SectionCard
      title={t("settings.rolePermissions")}
      description={t("settings.rolePermissionsDesc")}
      actions={
        <button
          type="button"
          onClick={resetToDefaults}
          className="text-xs text-slate-500 hover:text-slate-700 underline"
        >
          {t("settings.resetToDefaults")}
        </button>
      }
    >
      {/* Scrollable table on mobile */}
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-start text-xs font-semibold text-slate-500 pb-3 pe-4 min-w-[140px]">
                {/* empty — permission names in rows */}
              </th>
              {ROLES.map((role) => (
                <th
                  key={role}
                  className="text-center text-xs font-semibold text-slate-600 pb-3 px-3 min-w-[80px]"
                >
                  {roleLabels[role]}
                  {role === "owner" && (
                    <span className="block text-[10px] font-normal text-slate-400">
                      {t("settings.roleFullAccess")}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {PERM_KEYS.map((perm) => (
              <tr key={perm} className="hover:bg-slate-50 transition-colors">
                <td className="py-2.5 pe-4 text-sm text-slate-700 font-medium">
                  {permLabels[perm]}
                </td>
                {ROLES.map((role) => {
                  const checked = getEffective(role, perm);
                  const isOwner = role === "owner";
                  return (
                    <td key={role} className="py-2.5 px-3 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded accent-brand cursor-pointer disabled:cursor-not-allowed"
                        checked={checked}
                        disabled={isOwner}
                        onChange={() => toggle(role, perm)}
                        aria-label={`${roleLabels[role]} — ${permLabels[perm]}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex justify-end">
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? t("common.loading") : t("settings.save")}
        </Button>
      </div>
    </SectionCard>
  );
}

// ─── Cloud Backup Card ───────────────────────────────────────────────────────

function CloudBackupCard() {
  const { user } = useAuth();
  const { push } = useToast();
  const { t } = useLocale();
  const uid = user?.uid;
  const [syncing, setSyncing] = useState(false);
  const [syncMeta, setSyncMeta] = useState<SyncMeta | null>(null);

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
        push(t("settings.syncResolveConflictFirst"), "error");
        return;
      }

      if (pendingCount > 0) {
        window.dispatchEvent(new Event("shopkeeper:sync-requested"));
        push(t("settings.syncPendingRetry", { count: pendingCount }), "error");
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
          disabled={syncing}
          className="shrink-0"
        >
          {syncing ? t("sync.syncing") : t("settings.syncNow")}
        </Button>
      }
    >
      {syncMeta ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
        <p className="text-xs text-slate-400">{t("settings.neverSynced")}</p>
      )}
    </SectionCard>
  );
}

// ─── Device Health Card ──────────────────────────────────────────────────────

function DeviceHealthCard() {
  const { t } = useLocale();
  const { push } = useToast();
  const { canExport } = usePermissions();
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
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

  async function performClearCaches() {
    const browserWindow = window as Window & typeof globalThis;
    setClearConfirmOpen(false);
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

  return (
    <SectionCard
      title={t("settings.deviceHealth")}
      description={t("settings.deviceHealthDesc")}
      actions={
        <Button
          type="button"
          variant="secondary"
          onClick={refreshHealth}
          disabled={loading}
          className="shrink-0"
        >
          {loading ? t("common.loading") : t("settings.refreshHealth")}
        </Button>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

      <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
        {blocked > 0 ? (
          <span className="font-medium text-danger">
            {t("settings.blockedSyncWarning", { count: blocked })}
          </span>
        ) : stats?.failed ? (
          <span className="font-medium text-danger">
            {t("settings.failedSyncWarning", { count: stats.failed })}
          </span>
        ) : waiting > 0 ? (
          <span className="font-medium text-info">
            {t("settings.waitingSyncWarning", { count: waiting })}
          </span>
        ) : (
          <span className="font-medium text-success">
            {t("settings.healthLooksGood")}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-col sm:flex-row gap-2 flex-wrap">
        {canExport && (
          <Button
            type="button"
            variant="secondary"
            onClick={handleExportBackup}
            disabled={exporting}
          >
            {exporting
              ? t("settings.exportingBackup")
              : t("settings.exportLocalBackup")}
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={handleRetryFailed}
          disabled={repairing}
        >
          {repairing ? t("sync.syncing") : t("settings.retryFailedSync")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setClearConfirmOpen(true)}
        >
          {t("settings.clearCacheReload")}
        </Button>
      </div>

      <ClearCacheConfirmModal
        open={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        onConfirm={performClearCaches}
        waitingCount={waiting}
        conflictCount={stats?.conflict ?? 0}
      />
    </SectionCard>
  );
}

function ClearCacheConfirmModal({
  open,
  onClose,
  onConfirm,
  waitingCount,
  conflictCount,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  waitingCount: number;
  conflictCount: number;
}) {
  const { t } = useLocale();
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const blocked = conflictCount > 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("settings.clearCacheConfirmTitle")}
      description={t("settings.clearCacheConfirmDesc")}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onConfirm}
            disabled={blocked}
          >
            {t("settings.clearCacheConfirmButton")}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-600">
        <p className="rounded-xl bg-success-soft border border-success/20 px-3 py-2 text-success">
          {t("settings.clearCacheDataNote")}
        </p>
        {conflictCount > 0 && (
          <p className="rounded-xl bg-danger-soft border border-danger/20 px-3 py-2 text-danger">
            {t("settings.clearCacheConflictsWarning", { count: conflictCount })}
          </p>
        )}
        {offline && (
          <p className="rounded-xl bg-warning-soft border border-warning/30 px-3 py-2 text-warning">
            {t("settings.clearCacheOfflineWarning")}
          </p>
        )}
        {waitingCount > 0 && (
          <p className="rounded-xl bg-info-soft border border-info/30 px-3 py-2 text-info">
            {t("settings.clearCacheUnsyncedWarning", { count: waitingCount })}
          </p>
        )}
      </div>
    </Modal>
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
        "flex flex-col gap-0.5",
        wide && "col-span-2 sm:col-span-1",
      )}
    >
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-700 tabular-nums">
        {value}
      </span>
    </div>
  );
}

"use client";

import Link from "next/link";
import clsx from "clsx";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import { seedDemoData } from "@/lib/db/seed";
import { getLocalDataSummary } from "@/lib/services/account-data-service";
import { isDemoDataUiEnabled } from "@/lib/config/feature-flags";
import { addMoney, formatCurrency, multiplyMoney } from "@/lib/utils/money";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { StatCard, type StatTone } from "@/components/ui/stat-card";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import { getBillNetTotal } from "@/features/bills/utils/bill-summary";
import { getSupplierLedger } from "@/lib/services/supplier-ledger-service";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  LayoutDashboard,
  Plus,
  Play,
} from "@/components/ui/icons";

export default function DashboardPage() {
  const { t } = useLocale();
  const products = useLiveQuery(() => db.products.toArray(), []);
  const bills = useLiveQuery(() => db.bills.toArray(), []);
  const stockMovements = useLiveQuery(
    () => db.stockMovements.orderBy("createdAt").reverse().limit(5).toArray(),
    [],
  );
  const inventoryLots = useLiveQuery(() => db.inventoryLots.toArray(), []);
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const supplierLedger = useLiveQuery(() => getSupplierLedger(), []);
  const localSummary = useLiveQuery(() => getLocalDataSummary(), []);
  const [demoConfirmOpen, setDemoConfirmOpen] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const { push } = useToast();

  const liveProducts = products?.filter((p) => p.status === "active") ?? [];
  const lowStockCount = liveProducts.filter(
    (p) => p.quantityInStock <= p.minimumStockAlert,
  ).length;
  // FIFO cost value of stock on hand: sum(quantityRemaining × unitCost) over
  // non-voided lots, not quantityInStock × latest buyPrice.
  const totalInventoryValue = (inventoryLots ?? []).reduce(
    (s, lot) =>
      lot.status === "voided" || lot.quantityRemaining <= 0
        ? s
        : addMoney(s, multiplyMoney(lot.unitCost, lot.quantityRemaining)),
    0,
  );
  // Use net total so voided bills contribute 0 and partial returns reduce the
  // figure correctly — matches what the bills page and reports already show.
  const totalSales = (bills ?? []).reduce((s, b) => s + getBillNetTotal(b), 0);
  // Sum of positive supplier balances — what we owe to all suppliers combined.
  // Negative balances (supplier credit / overpayments) aren't subtracted here
  // because they aren't liquid: we can't use a $20 credit at supplier A to
  // pay supplier B. They show up separately in the supplier ledger.
  const owedToSuppliers = (supplierLedger ?? []).reduce(
    (sum, row) => sum + Math.max(0, row.balanceOwed),
    0,
  );
  const currency = settings?.currency ?? "ILS";

  const isBusinessEmpty = localSummary?.hasBusinessData === false;
  const canShowDemoDataAction = isDemoDataUiEnabled() && isBusinessEmpty;

  async function initializeDemo() {
    setDemoLoading(true);
    try {
      const result = await seedDemoData();
      push(
        result.inserted ? t("dashboard.demoInserted") : t("dashboard.demoExists"),
      );
    } finally {
      setDemoLoading(false);
      setDemoConfirmOpen(false);
    }
  }

  const stats: Array<{ label: string; value: string | number; tone: StatTone }> = [
    { label: t("dashboard.liveProducts"), value: liveProducts.length, tone: "brand" },
    {
      label: t("dashboard.lowStock"),
      value: lowStockCount,
      tone: lowStockCount > 0 ? "warning" : "neutral",
    },
    {
      label: t("dashboard.totalSales"),
      value: formatCurrency(totalSales, currency),
      tone: "positive",
    },
    {
      label: t("dashboard.inventoryCost"),
      value: formatCurrency(totalInventoryValue, currency),
      tone: "money",
    },
    {
      label: t("dashboard.owedToSuppliers"),
      value: formatCurrency(owedToSuppliers, currency),
      tone: owedToSuppliers > 0 ? "warning" : "neutral",
    },
  ];

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <PageHeader
          title={settings?.storeName ?? t("sidebar.subtitle")}
          description={t("dashboard.tagline")}
          icon={<LayoutDashboard size={24} aria-hidden />}
          actions={
            <>
              <Link
                href="/billing"
                className={clsx(
                  "inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold",
                  "bg-brand text-white transition-colors hover:bg-brand-hover",
                  "focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brand)_22%,transparent)]",
                )}
              >
                <Plus size={16} strokeWidth={2.5} aria-hidden />
                {t("dashboard.createBill")}
              </Link>
            </>
          }
        />

        {/* Stats grid — one card per row on mobile so long currency
            values have the full content width to breathe. Step up at
            sm/lg/xl breakpoints. */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {stats.map(({ label, value, tone }) => (
            <StatCard key={label} label={label} value={value} tone={tone} filled />
          ))}
        </section>

        {/* New-user empty state */}
        {(products ?? []).length === 0 && (bills ?? []).length === 0 && (
          <Card>
            <EmptyState
              title={t("dashboard.emptyTitle")}
              description={t("dashboard.emptyDesc")}
            />
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              <Link
                href="/products"
                className={clsx(
                  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors",
                  "bg-surface-soft text-fg-secondary hover:bg-surface-muted",
                  "px-4 py-2.5 text-sm min-h-[42px]",
                )}
              >
                <Plus size={16} strokeWidth={2.5} aria-hidden />
                {t("dashboard.addFirstProduct")}
              </Link>
              <Link
                href="/shift"
                className={clsx(
                  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors",
                  "bg-brand text-white hover:bg-brand-hover",
                  "px-4 py-2.5 text-sm min-h-[42px]",
                )}
              >
                <Play size={16} strokeWidth={2.5} aria-hidden />
                {t("dashboard.openFirstShift")}
              </Link>
              {canShowDemoDataAction && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDemoConfirmOpen(true)}
                >
                  {t("dashboard.initDemo")}
                </Button>
              )}
            </div>
            <ConfirmDialog
              open={demoConfirmOpen}
              title={t("dashboard.demoConfirmTitle")}
              description={t("dashboard.demoConfirmDesc")}
              confirmLabel={t("dashboard.demoConfirmAction")}
              cancelLabel={t("common.cancel")}
              tone="warning"
              loading={demoLoading}
              onConfirm={initializeDemo}
              onCancel={() => setDemoConfirmOpen(false)}
            />
          </Card>
        )}

        {/* Recent movements */}
        <Card>
          <h3 className="text-sm font-semibold text-slate-700 mb-4">
            {t("dashboard.recentMovements")}
          </h3>
          <div className="flex flex-col divide-y divide-slate-100">
            {(stockMovements ?? []).length === 0 && (
              <p className="text-sm text-slate-400 py-2">
                {t("dashboard.noMovements")}
              </p>
            )}
            {(stockMovements ?? []).map((mv) => {
              const isIncrease = mv.quantityChange >= 0;
              return (
                <div
                  key={mv.id}
                  className="flex items-center gap-3 py-3"
                >
                  {/* Directional icon — green for stock entering the shop,
                      red for stock leaving the shop. Icons avoid relying on
                      RTL-sensitive diagonal arrows. */}
                  <span
                    aria-hidden
                    className={clsx(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      isIncrease
                        ? "bg-success-soft text-success"
                        : "bg-danger-soft text-danger",
                    )}
                  >
                    {isIncrease ? (
                      <ArrowDownToLine size={16} strokeWidth={2.5} />
                    ) : (
                      <ArrowUpFromLine size={16} strokeWidth={2.5} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700 capitalize truncate">
                      {mv.movementType}
                    </p>
                    {(mv.note || mv.referenceType) && (
                      <p className="text-xs text-slate-400 truncate">
                        {mv.note || mv.referenceType}
                      </p>
                    )}
                  </div>
                  <span
                    className={clsx(
                      "text-sm font-semibold tabular-nums shrink-0",
                      isIncrease ? "text-success" : "text-danger",
                    )}
                    dir="ltr"
                  >
                    {isIncrease && "+"}
                    {mv.quantityChange}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </PageShell>
  );
}

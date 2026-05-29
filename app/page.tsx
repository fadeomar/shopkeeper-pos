"use client";

import Link from "next/link";
import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import { seedDemoData } from "@/lib/db/seed";
import { formatCurrency } from "@/lib/utils/money";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FitText } from "@/components/ui/fit-text";
import { PageShell } from "@/components/ui/page-shell";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import { getBillNetTotal } from "@/features/bills/utils/bill-summary";
import { getSupplierLedger } from "@/lib/services/supplier-ledger-service";
import { ArrowDownLeft, ArrowUpRight, Plus, Play } from "lucide-react";

export default function DashboardPage() {
  const { t } = useLocale();
  const products = useLiveQuery(() => db.products.toArray(), []);
  const bills = useLiveQuery(() => db.bills.toArray(), []);
  const stockMovements = useLiveQuery(
    () => db.stockMovements.orderBy("createdAt").reverse().limit(5).toArray(),
    [],
  );
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const supplierLedger = useLiveQuery(() => getSupplierLedger(), []);
  const { push } = useToast();

  const liveProducts = products?.filter((p) => p.status === "active") ?? [];
  const lowStockCount = liveProducts.filter(
    (p) => p.quantityInStock <= p.minimumStockAlert,
  ).length;
  const totalInventoryValue = liveProducts.reduce(
    (s, p) => s + p.quantityInStock * p.buyPrice,
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

  async function initializeDemo() {
    const result = await seedDemoData();
    push(
      result.inserted ? t("dashboard.demoInserted") : t("dashboard.demoExists"),
    );
  }

  const stats = [
    { label: t("dashboard.liveProducts"), value: liveProducts.length },
    { label: t("dashboard.lowStock"), value: lowStockCount },
    {
      label: t("dashboard.totalSales"),
      value: formatCurrency(totalSales, currency),
    },
    {
      label: t("dashboard.inventoryCost"),
      value: formatCurrency(totalInventoryValue, currency),
    },
    {
      label: t("dashboard.owedToSuppliers"),
      value: formatCurrency(owedToSuppliers, currency),
    },
  ];

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        {/* Page header */}
        <section className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {settings?.storeName ?? t("sidebar.subtitle")}
            </h2>
            <p className="mt-1 text-sm text-slate-500 max-w-xl">
              {t("dashboard.tagline")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {process.env.NODE_ENV === "development" && (
              <Button
                type="button"
                variant="secondary"
                onClick={initializeDemo}
              >
                {t("dashboard.initDemo")}
              </Button>
            )}
            <Link
              href="/billing"
              // Mirrors Button variant="primary" size="md" so the visual
              // language stays consistent. The leading Plus icon makes
              // the "create" semantics explicit at a glance — matters
              // more on the dashboard where this is the primary CTA.
              className={clsx(
                "inline-flex items-center justify-center gap-2 font-semibold rounded-xl",
                "px-4 py-2.5 text-sm min-h-[42px]",
                "bg-brand text-white hover:bg-brand-hover transition-colors",
                "focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brand)_22%,transparent)]",
              )}
            >
              <Plus size={16} strokeWidth={2.5} aria-hidden />
              {t("dashboard.createBill")}
            </Link>
          </div>
        </section>

        {/* Stats grid — one card per row on mobile so long currency
            values have the full content width to breathe. Step up at
            sm/lg/xl breakpoints. */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {stats.map(({ label, value }) => (
            <Card key={label} className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                {label}
              </p>
              {/* FitText scales down for unusually long values
                  (≥ $1M+) but the one-per-row mobile layout means
                  ordinary values render at full text-2xl. */}
              <FitText
                value={String(value)}
                size="2xl"
                className="font-bold text-slate-900"
              />
            </Card>
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
            </div>
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
                  {/* Directional icon — green up-right arrow for stock
                      coming in, red down-left for stock going out. Reads
                      faster than the +/- sign alone at small sizes. */}
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
                      <ArrowUpRight size={16} strokeWidth={2.5} />
                    ) : (
                      <ArrowDownLeft size={16} strokeWidth={2.5} />
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

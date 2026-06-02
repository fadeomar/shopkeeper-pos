"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import { formatCurrency, roundMoney } from "@/lib/utils/money";
import { downloadCSV } from "@/lib/utils/export-csv";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useLocale } from "@/components/providers/locale-context";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { usePermissions } from "@/lib/hooks/use-permissions";
import {
  buildDailyTrend,
  filterBillsForReport,
  filterByDateRange,
  filterExpensesForReport,
  getLowStockSoldProducts,
  getReportRange,
  summarizeProductSales,
  summarizeCategorySales,
  summarizeCustomerSales,
  summarizeSupplierPurchases,
  summarizeReportBills,
  summarizeReportExpenses,
  summarizeReportPurchases,
  type CategorySalesRow,
  type PartyReportRow,
  type ProductSalesRow,
  type ReportRange,
  type TrendRow,
} from "@/features/reports/utils/report-summary";

function ProductRows({
  rows,
  currency,
  emptyText,
  showProfit,
}: {
  rows: ProductSalesRow[];
  currency: string;
  emptyText: string;
  showProfit: boolean;
}) {
  const { t } = useLocale();
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-400">{emptyText}</p>
    );
  }

  return (
    <div className="divide-y divide-slate-100">
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm"
        >
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-800">{row.name}</p>
            <p className="truncate text-xs text-slate-500">
              {row.barcode} · {row.category || "—"}
            </p>
          </div>
          <div className="text-end">
            <p className="font-bold text-slate-900 tabular-nums">
              {formatCurrency(row.revenue, currency)}
            </p>
            <p className="text-xs text-slate-500">
              {t("reports.qty")}: {row.quantity}
              {showProfit ? ` · ${formatCurrency(row.profit, currency)}` : ""}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}


function CategoryRows({
  rows,
  currency,
  emptyText,
  showProfit,
}: {
  rows: CategorySalesRow[];
  currency: string;
  emptyText: string;
  showProfit: boolean;
}) {
  const { t } = useLocale();
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">{emptyText}</p>;
  }
  return (
    <div className="divide-y divide-slate-100">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm">
          <div>
            <p className="font-semibold text-slate-800">{row.category}</p>
            <p className="text-xs text-slate-500">{t("reports.qty")}: {row.quantity}</p>
          </div>
          <div className="text-end">
            <p className="font-bold tabular-nums text-slate-900">{formatCurrency(row.revenue, currency)}</p>
            {showProfit && <p className="text-xs text-success">{formatCurrency(row.profit, currency)}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function PartyRows({
  rows,
  currency,
  emptyText,
  dueLabel,
}: {
  rows: PartyReportRow[];
  currency: string;
  emptyText: string;
  dueLabel: string;
}) {
  const { t } = useLocale();
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">{emptyText}</p>;
  }
  return (
    <div className="divide-y divide-slate-100">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm">
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-800">{row.name}</p>
            <p className="truncate text-xs text-slate-500">
              {row.phone || "—"} · {row.count} {t("reports.entries")}
            </p>
          </div>
          <div className="text-end">
            <p className="font-bold tabular-nums text-slate-900">{formatCurrency(row.total, currency)}</p>
            {row.due > 0 && <p className="text-xs font-medium text-danger">{dueLabel}: {formatCurrency(row.due, currency)}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function TrendBars({ rows, currency }: { rows: TrendRow[]; currency: string }) {
  const max = Math.max(1, ...rows.map((row) => row.sales));

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const width = Math.max(4, Math.round((row.sales / max) * 100));
        return (
          <div
            key={row.label}
            className="grid grid-cols-[74px_1fr_auto] items-center gap-3 text-sm"
          >
            <span className="text-xs font-medium text-slate-500">
              {row.label}
            </span>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${width}%` }}
              />
            </div>
            <span className="text-xs font-semibold tabular-nums text-slate-700">
              {formatCurrency(row.sales, currency)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ReportsWorkspace() {
  const { t } = useLocale();
  const { canViewProfit } = usePermissions();
  const bills = useLiveQuery(
    () => db.bills.orderBy("createdAt").reverse().toArray(),
    [],
  );
  const billItems = useLiveQuery(() => db.billItems.toArray(), []);
  const products = useLiveQuery(() => db.products.toArray(), []);
  const purchases = useLiveQuery(
    () => db.purchases.orderBy("createdAt").reverse().toArray(),
    [],
  );
  const expenses = useLiveQuery(
    () => db.expenses.orderBy("createdAt").reverse().toArray(),
    [],
    [],
  );
  const supplierPayments = useLiveQuery(
    () => db.supplierPayments.toArray(),
    [],
  );
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const customerPayments = useLiveQuery(
    () => db.customerPayments.toArray(),
    [],
  );
  const [range, setRange] = useState<ReportRange>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const currency = settings?.currency ?? "ILS";
  const loading = !bills || !billItems || !products;

  const filteredBills = useMemo(
    () => filterBillsForReport(bills ?? [], { range, customFrom, customTo }),
    [bills, range, customFrom, customTo],
  );
  const filteredPurchases = useMemo(
    () => filterByDateRange(purchases ?? [], { range, customFrom, customTo }),
    [purchases, range, customFrom, customTo],
  );
  const filteredSupplierPayments = useMemo(
    () =>
      filterByDateRange(supplierPayments ?? [], {
        range,
        customFrom,
        customTo,
      }),
    [supplierPayments, range, customFrom, customTo],
  );
  const filteredExpenses = useMemo(
    () => filterExpensesForReport(expenses ?? [], { range, customFrom, customTo }),
    [expenses, range, customFrom, customTo],
  );
  const summary = useMemo(
    () => summarizeReportBills(filteredBills),
    [filteredBills],
  );
  const expenseSummary = useMemo(
    () => summarizeReportExpenses(filteredExpenses),
    [filteredExpenses],
  );
  const netProfitAfterExpenses = useMemo(
    () => roundMoney(summary.profit - expenseSummary.total),
    [summary.profit, expenseSummary.total],
  );
  const grossMargin = summary.sales > 0
    ? roundMoney((summary.profit / summary.sales) * 100)
    : 0;
  const customerPaymentsCashIn = useMemo(() => {
    const { from, to } = getReportRange({ range, customFrom, customTo });
    return (customerPayments ?? [])
      .filter((p) => {
        const created = new Date(p.createdAt);
        if (from && created < from) return false;
        if (to && created >= to) return false;
        return (p.paymentMethod ?? "cash") === "cash";
      })
      .reduce((sum, p) => sum + p.amount, 0);
  }, [customerPayments, range, customFrom, customTo]);
  const purchaseSummary = useMemo(
    () => summarizeReportPurchases(filteredPurchases, filteredSupplierPayments),
    [filteredPurchases, filteredSupplierPayments],
  );
  const productSales = useMemo(
    () => summarizeProductSales(filteredBills, billItems ?? [], products ?? []),
    [filteredBills, billItems, products],
  );
  const categorySales = useMemo(() => summarizeCategorySales(productSales).slice(0, 8), [productSales]);
  const topCustomers = useMemo(() => summarizeCustomerSales(filteredBills).slice(0, 8), [filteredBills]);
  const topSuppliers = useMemo(() => summarizeSupplierPurchases(filteredPurchases).slice(0, 8), [filteredPurchases]);
  const topProducts = productSales.slice(0, 8);
  const highestProfitProducts = [...productSales]
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 8);
  const lowStockSoldProducts = getLowStockSoldProducts(productSales).slice(
    0,
    8,
  );
  const trendRows = useMemo(
    () => buildDailyTrend(filteredBills, 7),
    [filteredBills],
  );

  function exportReportsCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    const rows = [
      { label: t("reports.totalSales"), value: summary.sales },
      ...(canViewProfit
        ? [
            { label: t("reports.totalProfit"), value: summary.profit },
            { label: t("reports.expensesTotal"), value: expenseSummary.total },
            { label: t("reports.netProfitAfterExpenses"), value: netProfitAfterExpenses },
          ]
        : []),
      { label: t("reports.purchaseCost"), value: purchaseSummary.purchaseCost },
      { label: t("reports.supplierPayments"), value: purchaseSummary.supplierPayments },
      { label: t("reports.cashExpected"), value: summary.cashExpected },
    ];

    downloadCSV(
      rows,
      [
        { header: "metric", value: (row) => row.label },
        { header: "value", value: (row) => row.value },
      ],
      `asas-reports-${stamp}.csv`,
    );
  }

  if (loading) {
    return (
      <Card>
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      </Card>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title={t("reports.title")}
        description={t("reports.subtitle")}
        actions={
          <>
            <Link
              // typed-routes hasn't been regenerated yet for the new /reports/z page;
              // the route exists at app/reports/z/page.tsx so the cast is safe.
              href={"/reports/z" as never}
              className="inline-flex min-h-[42px] items-center justify-center rounded-xl bg-success px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-success/90"
            >
              {t("reports.openZReport")}
            </Link>
            <Button type="button" variant="secondary" onClick={exportReportsCsv}>
              {t("reports.exportCsv")}
            </Button>
            <Link
              href="/bills"
              className="inline-flex min-h-[42px] items-center justify-center rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200"
            >
              {t("reports.openBills")}
            </Link>
            <Link
              href="/inventory"
              className="inline-flex min-h-[42px] items-center justify-center rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              {t("reports.openInventory")}
            </Link>
          </>
        }
      />

      <Card>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              {t("reports.period")}
              <SearchableSelect
                value={range}
                onValueChange={(value) =>
                  setRange((value ?? "today") as ReportRange)
                }
                placeholder={t("reports.period")}
                searchPlaceholder={t("common.search")}
                options={[
                  { value: "today", label: t("reports.today") },
                  { value: "week", label: t("reports.last7Days") },
                  { value: "month", label: t("reports.thisMonth") },
                  { value: "all", label: t("reports.allTime") },
                  { value: "custom", label: t("reports.customRange") },
                ]}
              />
            </label>
            {range === "custom" && (
              <>
                <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                  {t("reports.fromDate")}
                  <Input
                    type="date"
                    value={customFrom}
                    onChange={(event) => setCustomFrom(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                  {t("reports.toDate")}
                  <Input
                    type="date"
                    value={customTo}
                    onChange={(event) => setCustomTo(event.target.value)}
                  />
                </label>
              </>
            )}
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setRange("today");
              setCustomFrom("");
              setCustomTo("");
            }}
          >
            {t("common.reset")}
          </Button>
        </div>
      </Card>

      {/* Money-in: 5 cards spread across the row on desktop (lg:grid-cols-5)
          so the 5th card no longer wraps onto an orphan row; on small screens
          the trailing odd card stretches full-width instead of sitting alone. */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          filled
          tone="brand"
          label={t("reports.totalSales")}
          value={formatCurrency(summary.sales, currency)}
          href="/bills"
        />
        {canViewProfit && (
          <StatCard
            filled
            tone="positive"
            label={t("reports.totalProfit")}
            value={formatCurrency(summary.profit, currency)}
          />
        )}
        <StatCard
          filled
          tone="neutral"
          label={t("reports.billCount")}
          value={String(summary.billCount)}
          helper={`${t("reports.averageBill")}: ${formatCurrency(summary.averageBill, currency)}`}
          href="/bills"
        />
        <StatCard
          filled
          tone="info"
          label={t("reports.cashExpected")}
          value={formatCurrency(summary.cashExpected, currency)}
          href="/shift"
        />
        <StatCard
          filled
          tone="positive"
          className="col-span-2 lg:col-span-1"
          label={t("reports.customerPaymentsCashIn")}
          value={formatCurrency(customerPaymentsCashIn, currency)}
          href="/customers"
        />
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {canViewProfit && (
          <StatCard
            filled
            tone="positive"
            label={t("reports.grossProfitBeforeExpenses")}
            value={formatCurrency(summary.profit, currency)}
            helper={t("reports.grossProfitBeforeExpensesHelper")}
          />
        )}
        <StatCard
          filled
          tone="danger"
          label={t("reports.expensesTotal")}
          value={formatCurrency(expenseSummary.total, currency)}
          helper={`${expenseSummary.expenseCount} ${t("reports.entries")}`}
          href="/expenses"
        />
        {canViewProfit && (
          <StatCard
            filled
            tone={netProfitAfterExpenses >= 0 ? "positive" : "danger"}
            label={t("reports.netProfitAfterExpenses")}
            value={formatCurrency(netProfitAfterExpenses, currency)}
            helper={t("reports.netProfitAfterExpensesHelper")}
          />
        )}
        {canViewProfit && (
          <StatCard
            filled
            tone="info"
            label={t("reports.grossMargin")}
            value={`${grossMargin.toFixed(1)}%`}
            helper={t("reports.grossMarginHelper")}
          />
        )}
      </section>

      {/* Money-out */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          filled
          tone="warning"
          label={t("reports.purchaseCost")}
          value={formatCurrency(purchaseSummary.purchaseCost, currency)}
          helper={`${t("reports.purchaseCount")}: ${purchaseSummary.purchaseCount}`}
          href="/purchases/new"
        />
        <StatCard
          filled
          tone="warning"
          label={t("reports.cashPaidOut")}
          value={formatCurrency(purchaseSummary.cashPaidOut, currency)}
          helper={t("reports.cashPaidOutHelper")}
          href="/cash"
        />
        <StatCard
          filled
          tone="info"
          label={t("reports.supplierPayments")}
          value={formatCurrency(purchaseSummary.supplierPayments, currency)}
          helper={`${filteredSupplierPayments.length} ${t("reports.entries")}`}
          href="/suppliers"
        />
        <StatCard
          filled
          tone="danger"
          label={t("reports.netSupplierDebt")}
          value={formatCurrency(purchaseSummary.netSupplierDebt, currency)}
          helper={t("reports.netSupplierDebtHelper")}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="text-base font-semibold text-slate-900">
            {t("reports.paymentBreakdown")}
          </h3>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <StatCard
              filled
              tone="positive"
              label={t("common.cash")}
              value={formatCurrency(summary.byPayment.cash, currency)}
            />
            <StatCard
              filled
              tone="info"
              label={t("common.card")}
              value={formatCurrency(summary.byPayment.card, currency)}
            />
            {/* Mixed is a retired payment method — only shown if historical
                bills still carry a mixed total. */}
            {summary.byPayment.mixed > 0 && (
              <StatCard
                filled
                tone="neutral"
                label={t("common.mixed")}
                value={formatCurrency(summary.byPayment.mixed, currency)}
              />
            )}
            <StatCard
              filled
              tone="warning"
              label={t("common.credit")}
              value={formatCurrency(summary.byPayment.credit, currency)}
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {t("reports.adjustmentsNote")}: {t("common.voided")}{" "}
            {summary.voidedBills} · {t("common.returned")}{" "}
            {summary.returnedBills}
          </p>
        </Card>

        <Card>
          <h3 className="text-base font-semibold text-slate-900">
            {t("reports.purchasePaymentBreakdown")}
          </h3>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <StatCard filled tone="warning" label={t("common.cash")} value={formatCurrency(purchaseSummary.cashPaidOut, currency)} />
            <StatCard filled tone="info" label={t("common.card")} value={formatCurrency(purchaseSummary.cardPaidOut, currency)} />
            <StatCard filled tone="neutral" label={t("common.credit")} value={formatCurrency(purchaseSummary.debtAccrued, currency)} />
            <StatCard filled tone="danger" label={t("reports.supplierPayments")} value={formatCurrency(purchaseSummary.supplierPayments, currency)} />
          </div>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="text-base font-semibold text-slate-900">
            {t("reports.salesTrend")}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {t("reports.salesTrendDesc")}
          </p>
          <div className="mt-4">
            <TrendBars rows={trendRows} currency={currency} />
          </div>
        </Card>
      </section>



      <section className="grid gap-4 xl:grid-cols-3">
        <Card>
          <h3 className="text-base font-semibold text-slate-900">{t("reports.categorySales")}</h3>
          <p className="mt-1 text-sm text-slate-500">{t("reports.categorySalesDesc")}</p>
          <CategoryRows rows={categorySales} currency={currency} emptyText={t("reports.noProductSales")} showProfit={canViewProfit} />
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-slate-900">{t("reports.topCustomers")}</h3>
          <p className="mt-1 text-sm text-slate-500">{t("reports.topCustomersDesc")}</p>
          <PartyRows rows={topCustomers} currency={currency} emptyText={t("reports.noCustomersInPeriod")} dueLabel={t("reports.creditDue")} />
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-slate-900">{t("reports.topSuppliers")}</h3>
          <p className="mt-1 text-sm text-slate-500">{t("reports.topSuppliersDesc")}</p>
          <PartyRows rows={topSuppliers} currency={currency} emptyText={t("reports.noSuppliersInPeriod")} dueLabel={t("reports.amountDue")} />
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card>
          <h3 className="text-base font-semibold text-slate-900">
            {t("reports.topSellingProducts")}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {t("reports.topSellingProductsDesc")}
          </p>
          <ProductRows
            rows={topProducts}
            currency={currency}
            emptyText={t("reports.noProductSales")}
            showProfit={canViewProfit}
          />
        </Card>
        {canViewProfit && (
          <Card>
            <h3 className="text-base font-semibold text-slate-900">
              {t("reports.highestProfitProducts")}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {t("reports.highestProfitProductsDesc")}
            </p>
            <ProductRows
              rows={highestProfitProducts}
              currency={currency}
              emptyText={t("reports.noProductSales")}
              showProfit={canViewProfit}
            />
          </Card>
        )}
        <Card>
          <h3 className="text-base font-semibold text-slate-900">
            {t("reports.lowStockSoldProducts")}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {t("reports.lowStockSoldProductsDesc")}
          </p>
          <ProductRows
            rows={lowStockSoldProducts}
            currency={currency}
            emptyText={t("reports.noLowStockSold")}
            showProfit={canViewProfit}
          />
        </Card>
      </section>
    </PageShell>
  );
}

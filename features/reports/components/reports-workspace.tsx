"use client";

import { type ReactNode, useMemo, useState } from "react";
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
  filterShiftsForReport,
  getLowStockSoldProducts,
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
import { buildCashDrawerReconciliation, type AccountingIssue } from "@/features/reports/utils/accounting-reconciliation";

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
            <p className="truncate font-semibold text-slate-800">
              {row.isMisc ? t("reports.miscSales") : row.name}
            </p>
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


function ReportPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden bg-surface shadow-xs" padding="none">
      <div className="border-b border-border-subtle bg-surface-soft/45 px-5 py-4">
        <div className="mb-3 h-1 w-10 rounded-full bg-brand/35" aria-hidden />
        <h3 className="text-base font-semibold text-fg">{title}</h3>
        {description && (
          <p className="mt-1 text-sm leading-6 text-fg-muted">{description}</p>
        )}
      </div>
      <div className="px-5 py-4">{children}</div>
    </Card>
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

function AccountingIssues({
  issues,
}: {
  issues: AccountingIssue[];
}) {
  const { t } = useLocale();
  if (issues.length === 0) {
    return (
      <div className="rounded-2xl border border-success/20 bg-success-soft/30 px-4 py-3 text-sm font-medium text-success">
        {t("reports.reconciliationLooksGood")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {issues.map((issue) => {
        const tone = issue.severity === "danger"
          ? "border-danger/20 bg-danger-soft/30 text-danger"
          : "border-warning/20 bg-warning-soft/30 text-warning";
        const key = issue.key === "split_mismatch"
          ? "reports.reconciliationIssueSplitMismatch"
          : "reports.reconciliationIssueMissingShift";
        return (
          <div key={issue.key} className={`rounded-2xl border px-4 py-3 text-sm ${tone}`}>
            <p className="font-semibold">
              {t(key, { count: issue.count })}
            </p>
            {issue.sampleLabels.length > 0 && (
              <p className="mt-1 text-xs opacity-80">
                {t("reports.reconciliationSamples")}: {issue.sampleLabels.join(", ")}
              </p>
            )}
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
  const cashMovements = useLiveQuery(
    () => db.cashMovements.toArray(),
    [],
  );
  const shifts = useLiveQuery(() => db.shifts.toArray(), []);
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const customerPayments = useLiveQuery(
    () => db.customerPayments.toArray(),
    [],
  );
  const [range, setRange] = useState<ReportRange>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const reportFilters = useMemo(
    () => ({ range, customFrom, customTo }),
    [range, customFrom, customTo],
  );

  const currency = settings?.currency ?? "ILS";
  const loading = !bills || !billItems || !products;

  const filteredBills = useMemo(
    () => filterBillsForReport(bills ?? [], reportFilters),
    [bills, reportFilters],
  );
  const filteredPurchases = useMemo(
    () => filterByDateRange(purchases ?? [], reportFilters),
    [purchases, reportFilters],
  );
  const filteredSupplierPayments = useMemo(
    () => filterByDateRange(supplierPayments ?? [], reportFilters),
    [supplierPayments, reportFilters],
  );
  const filteredCustomerPayments = useMemo(
    () => filterByDateRange(customerPayments ?? [], reportFilters),
    [customerPayments, reportFilters],
  );
  const filteredExpenses = useMemo(
    () => filterExpensesForReport(expenses ?? [], reportFilters),
    [expenses, reportFilters],
  );
  const filteredCashMovements = useMemo(
    () => filterByDateRange(cashMovements ?? [], reportFilters),
    [cashMovements, reportFilters],
  );
  const shiftsInRange = useMemo(
    () => filterShiftsForReport(shifts ?? [], reportFilters),
    [shifts, reportFilters],
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
  const reconciliation = useMemo(
    () =>
      buildCashDrawerReconciliation({
        bills: filteredBills,
        purchases: filteredPurchases,
        customerPayments: filteredCustomerPayments,
        supplierPayments: filteredSupplierPayments,
        expenses: filteredExpenses,
        cashMovements: filteredCashMovements,
        shifts: shiftsInRange,
      }),
    [
      filteredBills,
      filteredPurchases,
      filteredCustomerPayments,
      filteredSupplierPayments,
      filteredExpenses,
      filteredCashMovements,
      shiftsInRange,
    ],
  );
  const customerPaymentsCashIn = reconciliation.customerCashIn;
  const drawerCashPaidOut = roundMoney(reconciliation.purchaseCashOut + reconciliation.supplierCashOut);
  const purchaseSummary = useMemo(
    () => summarizeReportPurchases(filteredPurchases, filteredSupplierPayments),
    [filteredPurchases, filteredSupplierPayments],
  );
  const productSales = useMemo(
    () => summarizeProductSales(filteredBills, billItems ?? [], products ?? []),
    [filteredBills, billItems, products],
  );
  // Aggregate the متفرقات (misc) rows into a single revenue/quantity figure
  // for the headline stat card.
  const miscSalesSummary = useMemo(
    () =>
      productSales
        .filter((row) => row.isMisc)
        .reduce(
          (acc, row) => ({
            quantity: acc.quantity + row.quantity,
            revenue: acc.revenue + row.revenue,
          }),
          { quantity: 0, revenue: 0 },
        ),
    [productSales],
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
      { label: t("reports.reconciliationOpening"), value: reconciliation.openingCash },
      { label: t("reports.reconciliationMoneyIn"), value: reconciliation.moneyIn },
      { label: t("reports.reconciliationMoneyOut"), value: reconciliation.moneyOut },
      { label: t("reports.cashExpected"), value: reconciliation.expectedDrawer },
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
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex sm:flex-wrap sm:justify-end">
            <Link
              // typed-routes hasn't been regenerated yet for the new /reports/z page;
              // the route exists at app/reports/z/page.tsx so the cast is safe.
              href={"/reports/z" as never}
              className="inline-flex min-h-[42px] items-center justify-center rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              {t("reports.openZReport")}
            </Link>
            <Button type="button" variant="secondary" onClick={exportReportsCsv}>
              {t("reports.exportCsv")}
            </Button>
            <Link
              href="/bills"
              className="inline-flex min-h-[42px] items-center justify-center rounded-xl bg-surface-soft px-4 py-2.5 text-sm font-semibold text-fg-secondary transition-colors hover:bg-surface-muted"
            >
              {t("reports.openBills")}
            </Link>
            <Link
              href="/inventory"
              className="inline-flex min-h-[42px] items-center justify-center rounded-xl bg-brand-soft px-4 py-2.5 text-sm font-semibold text-brand transition-colors hover:bg-brand-soft/80"
            >
              {t("reports.openInventory")}
            </Link>
          </div>
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

      {/* Money-in cards. The profit card is permission-gated (canViewProfit),
          so the desktop column count adapts: 6 cards when profit shows, 5 when
          it's hidden — either way the row fills evenly with no orphan. */}
      <section
        className={`grid grid-cols-2 gap-4 ${canViewProfit ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}
      >
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
            helper={t("reports.profitExcludesMisc")}
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
          value={formatCurrency(reconciliation.expectedDrawer, currency)}
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
        <StatCard
          filled
          tone="neutral"
          label={t("reports.miscSales")}
          value={formatCurrency(miscSalesSummary.revenue, currency)}
          helper={t("reports.miscSalesHelper", { count: String(miscSalesSummary.quantity) })}
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
          value={formatCurrency(drawerCashPaidOut, currency)}
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

      <ReportPanel
        title={t("reports.reconciliationTitle")}
        description={t("reports.reconciliationDesc")}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            filled
            tone="neutral"
            label={t("reports.reconciliationOpening")}
            value={formatCurrency(reconciliation.openingCash, currency)}
          />
          <StatCard
            filled
            tone="positive"
            label={t("reports.reconciliationMoneyIn")}
            value={formatCurrency(reconciliation.moneyIn, currency)}
          />
          <StatCard
            filled
            tone="danger"
            label={t("reports.reconciliationMoneyOut")}
            value={formatCurrency(reconciliation.moneyOut, currency)}
          />
          <StatCard
            filled
            tone="info"
            label={t("reports.reconciliationExpectedDrawer")}
            value={formatCurrency(reconciliation.expectedDrawer, currency)}
          />
        </div>
        <div className="mt-4 rounded-2xl border border-border-subtle bg-surface-soft/40 p-4 text-sm text-fg-secondary">
          <p className="font-semibold text-fg">{t("reports.reconciliationFormula")}</p>
          <p className="mt-1 leading-6">{t("reports.reconciliationFormulaText")}</p>
          <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <span>{t("reports.zDrawerSalesCash")}: {formatCurrency(reconciliation.salesCash, currency)}</span>
            <span>{t("reports.zDrawerCustomerCashIn")}: {formatCurrency(reconciliation.customerCashIn, currency)}</span>
            <span>{t("reports.zDrawerPurchaseCashOut")}: {formatCurrency(reconciliation.purchaseCashOut, currency)}</span>
            <span>{t("reports.zDrawerSupplierPaymentsCash")}: {formatCurrency(reconciliation.supplierCashOut, currency)}</span>
            <span>{t("reports.zDrawerExpensesCash")}: {formatCurrency(reconciliation.expenseCashOut, currency)}</span>
            <span>{t("reports.zDrawerCashMovements")}: {reconciliation.manualCashNet >= 0 ? "+" : ""}{formatCurrency(reconciliation.manualCashNet, currency)}</span>
          </div>
        </div>
        <div className="mt-4">
          <AccountingIssues issues={reconciliation.issues} />
        </div>
      </ReportPanel>

      <section className="grid gap-4 lg:grid-cols-2">
        <ReportPanel title={t("reports.paymentBreakdown")}>
          <div className="grid grid-cols-2 gap-3 text-sm">
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
        </ReportPanel>

        <ReportPanel title={t("reports.purchasePaymentBreakdown")}>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <StatCard filled tone="warning" label={t("common.cash")} value={formatCurrency(purchaseSummary.cashPaidOut, currency)} />
            <StatCard filled tone="info" label={t("common.card")} value={formatCurrency(purchaseSummary.cardPaidOut, currency)} />
            <StatCard filled tone="neutral" label={t("common.credit")} value={formatCurrency(purchaseSummary.debtAccrued, currency)} />
            <StatCard filled tone="danger" label={t("reports.supplierPayments")} value={formatCurrency(purchaseSummary.supplierPayments, currency)} />
          </div>
        </ReportPanel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ReportPanel
          title={t("reports.salesTrend")}
          description={t("reports.salesTrendDesc")}
        >
          <TrendBars rows={trendRows} currency={currency} />
        </ReportPanel>
      </section>



      <section className="grid gap-4 xl:grid-cols-3">
        <ReportPanel
          title={t("reports.categorySales")}
          description={t("reports.categorySalesDesc")}
        >
          <CategoryRows rows={categorySales} currency={currency} emptyText={t("reports.noProductSales")} showProfit={canViewProfit} />
        </ReportPanel>
        <ReportPanel
          title={t("reports.topCustomers")}
          description={t("reports.topCustomersDesc")}
        >
          <PartyRows rows={topCustomers} currency={currency} emptyText={t("reports.noCustomersInPeriod")} dueLabel={t("reports.creditDue")} />
        </ReportPanel>
        <ReportPanel
          title={t("reports.topSuppliers")}
          description={t("reports.topSuppliersDesc")}
        >
          <PartyRows rows={topSuppliers} currency={currency} emptyText={t("reports.noSuppliersInPeriod")} dueLabel={t("reports.amountDue")} />
        </ReportPanel>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <ReportPanel
          title={t("reports.topSellingProducts")}
          description={t("reports.topSellingProductsDesc")}
        >
          <ProductRows
            rows={topProducts}
            currency={currency}
            emptyText={t("reports.noProductSales")}
            showProfit={canViewProfit}
          />
        </ReportPanel>
        {canViewProfit && (
          <ReportPanel
            title={t("reports.highestProfitProducts")}
            description={t("reports.highestProfitProductsDesc")}
          >
            <ProductRows
              rows={highestProfitProducts}
              currency={currency}
              emptyText={t("reports.noProductSales")}
              showProfit={canViewProfit}
            />
          </ReportPanel>
        )}
        <ReportPanel
          title={t("reports.lowStockSoldProducts")}
          description={t("reports.lowStockSoldProductsDesc")}
        >
          <ProductRows
            rows={lowStockSoldProducts}
            currency={currency}
            emptyText={t("reports.noLowStockSold")}
            showProfit={canViewProfit}
          />
        </ReportPanel>
      </section>
    </PageShell>
  );
}

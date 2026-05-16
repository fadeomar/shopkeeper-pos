"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import { formatCurrency } from "@/lib/utils/money";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/loading-state";
import { SectionCard } from "@/components/ui/section-card";
import { Select } from "@/components/ui/select";
import { Toolbar } from "@/components/ui/toolbar";
import { useLocale } from "@/components/providers/locale-context";
import { PriceDisplay } from "@/components/pos/price-display";
import {
  buttonSizes,
  buttonVariants,
  dividerClasses,
  typographyClasses,
} from "@/lib/design/variants";
import {
  buildDailyTrend,
  filterBillsForReport,
  filterByDateRange,
  getLowStockSoldProducts,
  summarizeProductSales,
  summarizeReportBills,
  summarizeReportPurchases,
  type ProductSalesRow,
  type ReportRange,
  type TrendRow,
} from "@/features/reports/utils/report-summary";

function ReportStatCard({
  label,
  value,
  helper,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <SectionCard
      tone={tone}
      padding="sm"
      className="min-h-[112px] justify-between"
    >
      <div>
        <p className={typographyClasses.statLabel}>{label}</p>
        <div className={clsx("mt-2", typographyClasses.statValue)}>{value}</div>
      </div>
      {helper && (
        <p className={clsx("mt-1", typographyClasses.statHelper)}>{helper}</p>
      )}
    </SectionCard>
  );
}

function ProductRows({
  rows,
  currency,
  emptyText,
}: {
  rows: ProductSalesRow[];
  currency: string;
  emptyText: string;
}) {
  const { t } = useLocale();
  if (rows.length === 0) {
    return <EmptyState title={emptyText} compact />;
  }

  return (
    <div className={dividerClasses.subtle}>
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm"
        >
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-800">{row.name}</p>
            <p className={clsx("truncate", typographyClasses.hint)}>
              {row.barcode} · {row.category || "—"}
            </p>
          </div>
          <div className="text-end">
            <PriceDisplay value={row.revenue} currency={currency} emphasis />
            <p className={typographyClasses.hint}>
              {t("reports.qty")}: {row.quantity} ·{" "}
              {formatCurrency(row.profit, currency)}
            </p>
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
                className="h-full rounded-full bg-blue-600"
                style={{ width: `${width}%` }}
              />
            </div>
            <PriceDisplay value={row.sales} currency={currency} size="sm" />
          </div>
        );
      })}
    </div>
  );
}

export function ReportsWorkspace() {
  const { t } = useLocale();
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
  const supplierPayments = useLiveQuery(
    () => db.supplierPayments.toArray(),
    [],
  );
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const [range, setRange] = useState<ReportRange>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const currency = settings?.currency ?? "USD";
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
  const summary = useMemo(
    () => summarizeReportBills(filteredBills),
    [filteredBills],
  );
  const purchaseSummary = useMemo(
    () => summarizeReportPurchases(filteredPurchases, filteredSupplierPayments),
    [filteredPurchases, filteredSupplierPayments],
  );
  const productSales = useMemo(
    () => summarizeProductSales(filteredBills, billItems ?? [], products ?? []),
    [filteredBills, billItems, products],
  );
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

  if (loading) {
    return <LoadingState title={t("common.loading")} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <Toolbar align="between" className="items-start">
        <div />
        <div className="flex flex-wrap gap-2">
          <Link
            href="/bills"
            className={clsx(
              "inline-flex items-center justify-center font-semibold transition-colors",
              buttonSizes.md,
              buttonVariants.secondary,
            )}
          >
            {t("reports.openBills")}
          </Link>
          <Link
            href="/inventory"
            className={clsx(
              "inline-flex items-center justify-center font-semibold transition-colors",
              buttonSizes.md,
              buttonVariants.primary,
            )}
          >
            {t("reports.openInventory")}
          </Link>
        </div>
      </Toolbar>

      <SectionCard>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label={t("reports.period")}>
              <Select
                value={range}
                onChange={(event) =>
                  setRange(event.target.value as ReportRange)
                }
              >
                <option value="today">{t("reports.today")}</option>
                <option value="week">{t("reports.last7Days")}</option>
                <option value="month">{t("reports.thisMonth")}</option>
                <option value="all">{t("reports.allTime")}</option>
                <option value="custom">{t("reports.customRange")}</option>
              </Select>
            </FormField>
            {range === "custom" && (
              <>
                <FormField label={t("reports.fromDate")}>
                  <Input
                    type="date"
                    value={customFrom}
                    onChange={(event) => setCustomFrom(event.target.value)}
                  />
                </FormField>
                <FormField label={t("reports.toDate")}>
                  <Input
                    type="date"
                    value={customTo}
                    onChange={(event) => setCustomTo(event.target.value)}
                  />
                </FormField>
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
      </SectionCard>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <ReportStatCard
          label={t("reports.totalSales")}
          value={
            <PriceDisplay
              value={summary.sales}
              currency={currency}
              size="xl"
              emphasis
            />
          }
        />
        <ReportStatCard
          label={t("reports.totalProfit")}
          value={
            <PriceDisplay
              value={summary.profit}
              currency={currency}
              size="xl"
              emphasis
            />
          }
          tone="success"
        />
        <ReportStatCard
          label={t("reports.billCount")}
          value={String(summary.billCount)}
          helper={`${t("reports.averageBill")}: ${formatCurrency(summary.averageBill, currency)}`}
        />
        <ReportStatCard
          label={t("reports.cashExpected")}
          value={
            <PriceDisplay
              value={summary.cashExpected}
              currency={currency}
              size="xl"
              emphasis
            />
          }
        />
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <ReportStatCard
          label={t("reports.purchaseCost")}
          value={
            <PriceDisplay
              value={purchaseSummary.purchaseCost}
              currency={currency}
              size="xl"
              emphasis
            />
          }
          helper={`${t("reports.purchaseCount")}: ${purchaseSummary.purchaseCount}`}
        />
        <ReportStatCard
          label={t("reports.cashPaidOut")}
          value={
            <PriceDisplay
              value={purchaseSummary.cashPaidOut}
              currency={currency}
              size="xl"
              emphasis
            />
          }
          helper={t("reports.cashPaidOutHelper")}
          tone={purchaseSummary.cashPaidOut > 0 ? "warning" : "neutral"}
        />
        <ReportStatCard
          label={t("reports.supplierPayments")}
          value={
            <PriceDisplay
              value={purchaseSummary.supplierPayments}
              currency={currency}
              size="xl"
              emphasis
            />
          }
          helper={`${filteredSupplierPayments.length} ${t("reports.entries")}`}
        />
        <ReportStatCard
          label={t("reports.netSupplierDebt")}
          value={
            <PriceDisplay
              value={purchaseSummary.netSupplierDebt}
              currency={currency}
              size="xl"
              emphasis
            />
          }
          helper={t("reports.netSupplierDebtHelper")}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={t("reports.paymentBreakdown")}>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <ReportStatCard
              label={t("common.cash")}
              value={
                <PriceDisplay
                  value={summary.byPayment.cash}
                  currency={currency}
                  size="lg"
                  emphasis
                />
              }
            />
            <ReportStatCard
              label={t("common.card")}
              value={
                <PriceDisplay
                  value={summary.byPayment.card}
                  currency={currency}
                  size="lg"
                  emphasis
                />
              }
            />
            <ReportStatCard
              label={t("common.mixed")}
              value={
                <PriceDisplay
                  value={summary.byPayment.mixed}
                  currency={currency}
                  size="lg"
                  emphasis
                />
              }
            />
            <ReportStatCard
              label={t("common.credit")}
              value={
                <PriceDisplay
                  value={summary.byPayment.credit}
                  currency={currency}
                  size="lg"
                  emphasis
                />
              }
            />
          </div>
          <p className={typographyClasses.hint}>
            {t("reports.adjustmentsNote")}: {t("common.voided")}{" "}
            {summary.voidedBills} · {t("common.returned")}{" "}
            {summary.returnedBills}
          </p>
        </SectionCard>

        <SectionCard
          title={t("reports.salesTrend")}
          description={t("reports.salesTrendDesc")}
        >
          <TrendBars rows={trendRows} currency={currency} />
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard
          title={t("reports.topSellingProducts")}
          description={t("reports.topSellingProductsDesc")}
        >
          <ProductRows
            rows={topProducts}
            currency={currency}
            emptyText={t("reports.noProductSales")}
          />
        </SectionCard>
        <SectionCard
          title={t("reports.highestProfitProducts")}
          description={t("reports.highestProfitProductsDesc")}
        >
          <ProductRows
            rows={highestProfitProducts}
            currency={currency}
            emptyText={t("reports.noProductSales")}
          />
        </SectionCard>
        <SectionCard
          title={t("reports.lowStockSoldProducts")}
          description={t("reports.lowStockSoldProductsDesc")}
        >
          <ProductRows
            rows={lowStockSoldProducts}
            currency={currency}
            emptyText={t("reports.noLowStockSold")}
          />
        </SectionCard>
      </section>
    </div>
  );
}

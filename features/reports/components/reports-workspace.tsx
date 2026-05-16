'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db/schema';
import { settingsRepo } from '@/lib/db/repositories';
import { formatCurrency } from '@/lib/utils/money';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useLocale } from '@/components/providers/locale-context';
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
} from '@/features/reports/utils/report-summary';

function StatCard({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <Card className="min-h-[112px]">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black text-slate-900 tabular-nums">{value}</p>
      {helper && <p className="mt-1 text-xs text-slate-500">{helper}</p>}
    </Card>
  );
}

function ProductRows({ rows, currency, emptyText }: { rows: ProductSalesRow[]; currency: string; emptyText: string }) {
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
            <p className="truncate text-xs text-slate-500">{row.barcode} · {row.category || '—'}</p>
          </div>
          <div className="text-end">
            <p className="font-bold text-slate-900 tabular-nums">{formatCurrency(row.revenue, currency)}</p>
            <p className="text-xs text-slate-500">
              {t('reports.qty')}: {row.quantity} · {formatCurrency(row.profit, currency)}
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
          <div key={row.label} className="grid grid-cols-[74px_1fr_auto] items-center gap-3 text-sm">
            <span className="text-xs font-medium text-slate-500">{row.label}</span>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-blue-600" style={{ width: `${width}%` }} />
            </div>
            <span className="text-xs font-semibold tabular-nums text-slate-700">{formatCurrency(row.sales, currency)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ReportsWorkspace() {
  const { t } = useLocale();
  const bills = useLiveQuery(() => db.bills.orderBy('createdAt').reverse().toArray(), []);
  const billItems = useLiveQuery(() => db.billItems.toArray(), []);
  const products = useLiveQuery(() => db.products.toArray(), []);
  const purchases = useLiveQuery(() => db.purchases.orderBy('createdAt').reverse().toArray(), []);
  const supplierPayments = useLiveQuery(() => db.supplierPayments.toArray(), []);
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const [range, setRange] = useState<ReportRange>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const currency = settings?.currency ?? 'USD';
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
    () => filterByDateRange(supplierPayments ?? [], { range, customFrom, customTo }),
    [supplierPayments, range, customFrom, customTo],
  );
  const summary = useMemo(() => summarizeReportBills(filteredBills), [filteredBills]);
  const purchaseSummary = useMemo(
    () => summarizeReportPurchases(filteredPurchases, filteredSupplierPayments),
    [filteredPurchases, filteredSupplierPayments],
  );
  const productSales = useMemo(
    () => summarizeProductSales(filteredBills, billItems ?? [], products ?? []),
    [filteredBills, billItems, products],
  );
  const topProducts = productSales.slice(0, 8);
  const highestProfitProducts = [...productSales].sort((a, b) => b.profit - a.profit).slice(0, 8);
  const lowStockSoldProducts = getLowStockSoldProducts(productSales).slice(0, 8);
  const trendRows = useMemo(() => buildDailyTrend(filteredBills, 7), [filteredBills]);

  if (loading) {
    return (
      <Card>
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t('reports.title')}</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{t('reports.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/bills" className="inline-flex min-h-[42px] items-center justify-center rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200">
            {t('reports.openBills')}
          </Link>
          <Link href="/inventory" className="inline-flex min-h-[42px] items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700">
            {t('reports.openInventory')}
          </Link>
        </div>
      </section>

      <Card>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              {t('reports.period')}
              <Select value={range} onChange={(event) => setRange(event.target.value as ReportRange)}>
                <option value="today">{t('reports.today')}</option>
                <option value="week">{t('reports.last7Days')}</option>
                <option value="month">{t('reports.thisMonth')}</option>
                <option value="all">{t('reports.allTime')}</option>
                <option value="custom">{t('reports.customRange')}</option>
              </Select>
            </label>
            {range === 'custom' && (
              <>
                <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                  {t('reports.fromDate')}
                  <Input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                  {t('reports.toDate')}
                  <Input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
                </label>
              </>
            )}
          </div>
          <Button type="button" variant="secondary" onClick={() => { setRange('today'); setCustomFrom(''); setCustomTo(''); }}>
            {t('common.reset')}
          </Button>
        </div>
      </Card>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t('reports.totalSales')} value={formatCurrency(summary.sales, currency)} />
        <StatCard label={t('reports.totalProfit')} value={formatCurrency(summary.profit, currency)} />
        <StatCard label={t('reports.billCount')} value={String(summary.billCount)} helper={`${t('reports.averageBill')}: ${formatCurrency(summary.averageBill, currency)}`} />
        <StatCard label={t('reports.cashExpected')} value={formatCurrency(summary.cashExpected, currency)} />
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={t('reports.purchaseCost')}
          value={formatCurrency(purchaseSummary.purchaseCost, currency)}
          helper={`${t('reports.purchaseCount')}: ${purchaseSummary.purchaseCount}`}
        />
        <StatCard
          label={t('reports.cashPaidOut')}
          value={formatCurrency(purchaseSummary.cashPaidOut, currency)}
          helper={t('reports.cashPaidOutHelper')}
        />
        <StatCard
          label={t('reports.supplierPayments')}
          value={formatCurrency(purchaseSummary.supplierPayments, currency)}
          helper={`${filteredSupplierPayments.length} ${t('reports.entries')}`}
        />
        <StatCard
          label={t('reports.netSupplierDebt')}
          value={formatCurrency(purchaseSummary.netSupplierDebt, currency)}
          helper={t('reports.netSupplierDebtHelper')}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="text-base font-semibold text-slate-900">{t('reports.paymentBreakdown')}</h3>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <StatCard label={t('common.cash')} value={formatCurrency(summary.byPayment.cash, currency)} />
            <StatCard label={t('common.card')} value={formatCurrency(summary.byPayment.card, currency)} />
            <StatCard label={t('common.mixed')} value={formatCurrency(summary.byPayment.mixed, currency)} />
            <StatCard label={t('common.credit')} value={formatCurrency(summary.byPayment.credit, currency)} />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {t('reports.adjustmentsNote')}: {t('common.voided')} {summary.voidedBills} · {t('common.returned')} {summary.returnedBills}
          </p>
        </Card>

        <Card>
          <h3 className="text-base font-semibold text-slate-900">{t('reports.salesTrend')}</h3>
          <p className="mt-1 text-sm text-slate-500">{t('reports.salesTrendDesc')}</p>
          <div className="mt-4">
            <TrendBars rows={trendRows} currency={currency} />
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card>
          <h3 className="text-base font-semibold text-slate-900">{t('reports.topSellingProducts')}</h3>
          <p className="mt-1 text-sm text-slate-500">{t('reports.topSellingProductsDesc')}</p>
          <ProductRows rows={topProducts} currency={currency} emptyText={t('reports.noProductSales')} />
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-slate-900">{t('reports.highestProfitProducts')}</h3>
          <p className="mt-1 text-sm text-slate-500">{t('reports.highestProfitProductsDesc')}</p>
          <ProductRows rows={highestProfitProducts} currency={currency} emptyText={t('reports.noProductSales')} />
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-slate-900">{t('reports.lowStockSoldProducts')}</h3>
          <p className="mt-1 text-sm text-slate-500">{t('reports.lowStockSoldProductsDesc')}</p>
          <ProductRows rows={lowStockSoldProducts} currency={currency} emptyText={t('reports.noLowStockSold')} />
        </Card>
      </section>
    </div>
  );
}

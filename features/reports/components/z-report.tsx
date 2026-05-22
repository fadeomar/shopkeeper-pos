"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { useLocale } from "@/components/providers/locale-context";
import { formatCurrency, roundMoney } from "@/lib/utils/money";
import { formatDateTime, localDateKey } from "@/lib/utils/date";
import {
  filterBillsForReport,
  filterByDateRange,
  summarizeReportBills,
  summarizeReportCashMovements,
  summarizeReportExpenses,
  summarizeReportPurchases,
  type ReportRange,
  type ReportFilters,
} from "@/features/reports/utils/report-summary";
import { netSplitField, normalizeBillSplit } from "@/lib/utils/bill-split";
import type { Bill, CashMovement, CustomerPayment, Expense, ExpenseCategory, Purchase, Shift, SupplierPayment } from "@/types/domain";

function startEndForRange(range: ReportRange, customFrom: string, customTo: string): { from?: Date; to?: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (range === 'today') {
    const next = new Date(today);
    next.setDate(next.getDate() + 1);
    return { from: today, to: next };
  }
  if (range === 'week') {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    const to = new Date(today);
    to.setDate(to.getDate() + 1);
    return { from, to };
  }
  if (range === 'month') {
    return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: new Date(today.getFullYear(), today.getMonth() + 1, 1) };
  }
  if (range === 'custom') {
    const from = customFrom ? new Date(customFrom) : undefined;
    const to = customTo ? new Date(customTo) : undefined;
    if (to) to.setDate(to.getDate() + 1);
    return { from, to };
  }
  return {};
}

function categoryKey(c: ExpenseCategory): string {
  return `expenses.cat${c.charAt(0).toUpperCase()}${c.slice(1)}`;
}

export function ZReport() {
  const { t } = useLocale();

  const [range, setRange] = useState<ReportRange>('today');
  const [customFrom, setCustomFrom] = useState(localDateKey());
  const [customTo, setCustomTo] = useState(localDateKey());

  const filters: ReportFilters = { range, customFrom, customTo };

  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const currency = settings?.currency ?? 'USD';

  const bills = useLiveQuery(() => db.bills.toArray(), [], [] as Bill[]);
  const purchases = useLiveQuery(() => db.purchases.toArray(), [], [] as Purchase[]);
  const customerPayments = useLiveQuery(() => db.customerPayments.toArray(), [], [] as CustomerPayment[]);
  const supplierPayments = useLiveQuery(() => db.supplierPayments.toArray(), [], [] as SupplierPayment[]);
  const expenses = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[]);
  const cashMovements = useLiveQuery(() => db.cashMovements.toArray(), [], [] as CashMovement[]);
  const shifts = useLiveQuery(() => db.shifts.toArray(), [], [] as Shift[]);

  const result = useMemo(() => {
    const { from, to } = startEndForRange(range, customFrom, customTo);
    const inRange = <T extends { createdAt: string }>(rows: T[]): T[] =>
      rows.filter((row) => {
        const d = new Date(row.createdAt);
        if (from && d < from) return false;
        if (to && d >= to) return false;
        return true;
      });

    const filteredBills = filterBillsForReport(bills, filters);
    const filteredPurchases = filterByDateRange(purchases, filters);
    const filteredCustomerPayments = inRange(customerPayments);
    const filteredSupplierPayments = inRange(supplierPayments);
    const filteredExpenses = inRange(expenses);
    const filteredCashMovements = inRange(cashMovements);
    const shiftsInRange = shifts.filter((s) => {
      const d = new Date(s.openedAt);
      if (from && d < from) return false;
      if (to && d >= to) return false;
      return true;
    });

    const salesSummary = summarizeReportBills(filteredBills);
    const purchaseSummary = summarizeReportPurchases(filteredPurchases, filteredSupplierPayments);
    const expenseSummary = summarizeReportExpenses(filteredExpenses);
    const cashSummary = summarizeReportCashMovements(filteredCashMovements);

    // Drawer reconciliation: aggregate across all shifts that opened in
    // range. Sales cash uses bills' cashAmount net of returns. Purchases
    // cash uses purchases' cashAmount net of returns.
    const openingCashAcrossShifts = roundMoney(
      shiftsInRange.reduce((sum, s) => sum + (Number(s.openingCash) || 0), 0),
    );
    const salesCash = roundMoney(
      filteredBills.reduce(
        (sum, b) => sum + netSplitField(normalizeBillSplit(b), b.cashAmount ?? 0),
        0,
      ),
    );
    const purchaseCash = roundMoney(
      filteredPurchases.reduce(
        (sum, p) => sum + netSplitField(normalizeBillSplit(p), (p as Purchase).cashAmount ?? 0),
        0,
      ),
    );
    const customerCashIn = roundMoney(
      filteredCustomerPayments
        .filter((p) => !p.paymentMethod || p.paymentMethod === 'cash')
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
    );
    const supplierCashOut = roundMoney(
      filteredSupplierPayments
        .filter((p) => !p.paymentMethod || p.paymentMethod === 'cash')
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
    );
    const expectedDrawer = roundMoney(
      openingCashAcrossShifts +
        salesCash +
        customerCashIn -
        purchaseCash -
        supplierCashOut -
        expenseSummary.cashPaidOut +
        cashSummary.net,
    );

    return {
      salesSummary,
      purchaseSummary,
      expenseSummary,
      cashSummary,
      drawer: {
        openingCash: openingCashAcrossShifts,
        salesCash,
        customerCashIn,
        purchaseCash,
        supplierCashOut,
        expenseCash: expenseSummary.cashPaidOut,
        cashMovementsNet: cashSummary.net,
        expectedDrawer,
      },
      customerPaymentsTotal: roundMoney(
        filteredCustomerPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
      ),
    };
  }, [bills, purchases, customerPayments, supplierPayments, expenses, cashMovements, shifts, range, customFrom, customTo, filters]);

  return (
    <PageShell>
      <PageHeader
        title={t('reports.zReportTitle')}
        description={t('reports.zReportSubtitle')}
        actions={
          <div className="flex gap-2">
            <Link href="/reports">
              <Button type="button" variant="ghost">{t('reports.backToReports')}</Button>
            </Link>
            <Button type="button" variant="secondary" onClick={() => window.print()}>
              {t('reports.zReportPrint')}
            </Button>
          </div>
        }
      />

      <Card className="no-print">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:w-48">
            {t('reports.period')}
            <Select value={range} onChange={(e) => setRange(e.target.value as ReportRange)}>
              <option value="today">{t('reports.zRangeToday')}</option>
              <option value="week">{t('reports.zRangeThisWeek')}</option>
              <option value="month">{t('reports.thisMonth')}</option>
              <option value="custom">{t('reports.zRangeCustom')}</option>
            </Select>
          </label>
          {range === 'custom' && (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                {t('reports.fromDate')}
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} dir="ltr" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                {t('reports.toDate')}
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} dir="ltr" />
              </label>
            </>
          )}
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title={t('reports.zSalesHeader')}>
          <Row label={t('reports.zSalesNetRevenue')} value={formatCurrency(result.salesSummary.sales, currency)} bold />
          <Row label={t('reports.zSalesProfit')} value={formatCurrency(result.salesSummary.profit, currency)} />
          <Row label={t('reports.zSalesBillCount')} value={String(result.salesSummary.billCount)} />
          <Row label={t('reports.zSalesAverageBill')} value={formatCurrency(result.salesSummary.averageBill, currency)} />
          <Row label={t('reports.zSalesVoidedBills')} value={String(result.salesSummary.voidedBills)} />
          <Row label={t('reports.zSalesReturnedBills')} value={String(result.salesSummary.returnedBills)} />
        </Section>

        <Section title={t('reports.zTendersHeader')}>
          <Row label={t('reports.zTenderCash')} value={formatCurrency(result.salesSummary.byPayment.cash, currency)} />
          <Row label={t('reports.zTenderCard')} value={formatCurrency(result.salesSummary.byPayment.card, currency)} />
          <Row label={t('reports.zTenderMixed')} value={formatCurrency(result.salesSummary.byPayment.mixed, currency)} />
          <Row label={t('reports.zTenderCredit')} value={formatCurrency(result.salesSummary.byPayment.credit, currency)} />
        </Section>

        <Section title={t('reports.zPurchasesHeader')}>
          <Row label={t('reports.zPurchaseCost')} value={formatCurrency(result.purchaseSummary.purchaseCost, currency)} bold />
          <Row label={t('reports.zPurchaseCount')} value={String(result.purchaseSummary.purchaseCount)} />
          <Row label={t('reports.zSupplierPayments')} value={formatCurrency(result.purchaseSummary.supplierPayments, currency)} />
          <Row label={t('reports.zCustomerPayments')} value={formatCurrency(result.customerPaymentsTotal, currency)} />
        </Section>

        <Section title={t('reports.zExpensesHeader')}>
          <Row label={t('reports.zExpensesTotal')} value={formatCurrency(result.expenseSummary.total, currency)} bold />
          <Row label={t('reports.zExpensesCash')} value={formatCurrency(result.expenseSummary.cashPaidOut, currency)} />
          {result.expenseSummary.byCategory.length > 0 && (
            <div className="border-t border-slate-100 pt-2 mt-2">
              <p className="text-xs font-semibold text-slate-500 mb-1">{t('reports.zExpensesByCategory')}</p>
              {result.expenseSummary.byCategory.map((row) => (
                <div key={row.category} className="flex items-center justify-between py-0.5 text-xs">
                  <span className="text-slate-600">{t(categoryKey(row.category))}</span>
                  <span className="tabular-nums text-slate-700" dir="ltr">
                    {formatCurrency(row.amount, currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title={t('reports.zCashMovementsHeader')}>
          <Row label={t('reports.zCashIn')} value={formatCurrency(result.cashSummary.cashIn, currency)} />
          <Row label={t('reports.zCashOut')} value={formatCurrency(result.cashSummary.cashOut, currency)} />
          <Row label={t('reports.zCashNet')} value={`${result.cashSummary.net >= 0 ? '+' : ''}${formatCurrency(result.cashSummary.net, currency)}`} bold />
        </Section>

        <Section title={t('reports.zDrawerHeader')}>
          <Row label={t('reports.zDrawerOpening')} value={formatCurrency(result.drawer.openingCash, currency)} />
          <Row label={t('reports.zDrawerSalesCash')} value={formatCurrency(result.drawer.salesCash, currency)} />
          <Row label={t('reports.zDrawerCustomerCashIn')} value={formatCurrency(result.drawer.customerCashIn, currency)} />
          <Row label={t('reports.zDrawerPurchaseCashOut')} value={formatCurrency(result.drawer.purchaseCash, currency)} />
          <Row label={t('reports.zDrawerSupplierPaymentsCash')} value={formatCurrency(result.drawer.supplierCashOut, currency)} />
          <Row label={t('reports.zDrawerExpensesCash')} value={formatCurrency(result.drawer.expenseCash, currency)} />
          <Row label={t('reports.zDrawerCashMovements')} value={`${result.drawer.cashMovementsNet >= 0 ? '+' : ''}${formatCurrency(result.drawer.cashMovementsNet, currency)}`} />
          <Row label={t('reports.zDrawerExpected')} value={formatCurrency(result.drawer.expectedDrawer, currency)} bold highlight />
        </Section>
      </div>

      <p className="text-xs text-slate-400">
        {t('reports.zEndOfDay')}: {formatDateTime(new Date().toISOString())}
      </p>
    </PageShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>
      <div className="divide-y divide-slate-100">{children}</div>
    </Card>
  );
}

function Row({ label, value, bold, highlight }: { label: string; value: string; bold?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-2 text-sm ${highlight ? 'bg-emerald-50 -mx-2 px-2 rounded-lg' : ''}`}>
      <span className={bold ? 'font-semibold text-slate-800' : 'text-slate-600'}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`} dir="ltr">
        {value}
      </span>
    </div>
  );
}

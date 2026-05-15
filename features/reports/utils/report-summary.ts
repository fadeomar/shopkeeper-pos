import type { Bill, BillItem, PaymentMethod, Product, Purchase, SupplierPayment } from '@/types/domain';
import { getBillNetProfit, getBillNetTotal } from '@/features/bills/utils/bill-summary';
import { roundMoney } from '@/lib/utils/money';
import { netSplitField, normalizeBillSplit } from '@/lib/utils/bill-split';

export type ReportRange = 'today' | 'week' | 'month' | 'all' | 'custom';

export interface ReportFilters {
  range: ReportRange;
  customFrom: string;
  customTo: string;
}

export interface ProductSalesRow {
  key: string;
  name: string;
  barcode: string;
  category: string;
  quantity: number;
  revenue: number;
  profit: number;
  currentStock?: number;
  minimumStockAlert?: number;
}

export interface TrendRow {
  label: string;
  sales: number;
  profit: number;
  bills: number;
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function getReportRange(filters: ReportFilters): { from?: Date; to?: Date } {
  const today = startOfDay(new Date());

  if (filters.range === 'today') return { from: today, to: addDays(today, 1) };
  if (filters.range === 'week') return { from: addDays(today, -6), to: addDays(today, 1) };
  if (filters.range === 'month') return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: addDays(today, 1) };
  if (filters.range === 'custom') {
    return {
      from: filters.customFrom ? startOfDay(new Date(filters.customFrom)) : undefined,
      to: filters.customTo ? addDays(startOfDay(new Date(filters.customTo)), 1) : undefined,
    };
  }

  return {};
}

export function filterBillsForReport(bills: Bill[], filters: ReportFilters): Bill[] {
  const { from, to } = getReportRange(filters);
  return bills.filter((bill) => {
    const created = new Date(bill.createdAt);
    if (from && created < from) return false;
    if (to && created >= to) return false;
    return true;
  });
}

/**
 * Date-range filter for any record that has a createdAt ISO string. Mirror of
 * filterBillsForReport — extracted because purchases + supplier payments need
 * the same logic and we'd rather not duplicate the off-by-one date math.
 */
export function filterByDateRange<T extends { createdAt: string }>(
  rows: T[],
  filters: ReportFilters,
): T[] {
  const { from, to } = getReportRange(filters);
  return rows.filter((row) => {
    const created = new Date(row.createdAt);
    if (from && created < from) return false;
    if (to && created >= to) return false;
    return true;
  });
}

export function summarizeReportBills(bills: Bill[]) {
  return bills.reduce(
    (summary, bill) => {
      const billWithSplit = normalizeBillSplit(bill) as Bill;
      const netSales = getBillNetTotal(billWithSplit);
      const netProfit = getBillNetProfit(billWithSplit);
      summary.billCount += 1;
      summary.itemCount += billWithSplit.status === 'voided' ? 0 : billWithSplit.itemCount;
      summary.sales += netSales;
      summary.profit += netProfit;
      summary.averageBill = summary.billCount ? summary.sales / summary.billCount : 0;
      // Cash retained = the cashAmount portion of the bill, less the
      // proportional share of any returns/voids. Works for pure cash and the
      // cash leg of mixed bills uniformly, since both populate cashAmount.
      summary.cashExpected += netSplitField(billWithSplit, billWithSplit.cashAmount);
      summary.byPayment[billWithSplit.paymentMethod] += netSales;
      if (billWithSplit.status === 'voided') summary.voidedBills += 1;
      if (billWithSplit.status === 'returned' || billWithSplit.status === 'partially_returned') summary.returnedBills += 1;
      return summary;
    },
    {
      sales: 0,
      profit: 0,
      billCount: 0,
      itemCount: 0,
      averageBill: 0,
      cashExpected: 0,
      voidedBills: 0,
      returnedBills: 0,
      byPayment: { cash: 0, card: 0, mixed: 0, credit: 0 } as Record<PaymentMethod, number>,
    },
  );
}

/**
 * Buy-side report summary. Mirrors summarizeReportBills but inverts every
 * direction-of-money field.
 *
 *   purchaseCost     — gross cost paid for purchases (net of returns to
 *                      supplier). Equivalent of "sales" on the sell side.
 *   cashPaidOut      — cash leg of purchases (net of returns), the negative
 *                      pressure on the cash drawer.
 *   cardPaidOut      — card leg of purchases (informational; doesn't touch
 *                      the cash drawer).
 *   debtAccrued      — credit leg of purchases — what we owe suppliers at
 *                      the moment of each purchase.
 *   supplierPayments — debt-settlement payments to suppliers during the
 *                      range. Subtracts from the open balance.
 *   netSupplierDebt  — debtAccrued − supplierPayments. Approximates the
 *                      change in supplier payable over the date range.
 */
export function summarizeReportPurchases(
  purchases: Purchase[],
  supplierPayments: SupplierPayment[],
) {
  const summary = purchases.reduce(
    (acc, raw) => {
      const p = normalizeBillSplit(raw as unknown as Bill) as unknown as Purchase;
      const netCost = Math.max(0, p.totalAmount - (p.returnedAmount ?? 0));
      const netCash = netSplitField(p as unknown as Bill, p.cashAmount);
      const netCard = netSplitField(p as unknown as Bill, p.cardAmount);
      const netCredit = netSplitField(p as unknown as Bill, p.creditAmount);
      acc.purchaseCount += 1;
      acc.itemCount += p.status === 'voided' ? 0 : p.itemCount;
      acc.purchaseCost = roundMoney(acc.purchaseCost + netCost);
      acc.cashPaidOut = roundMoney(acc.cashPaidOut + netCash);
      acc.cardPaidOut = roundMoney(acc.cardPaidOut + netCard);
      acc.debtAccrued = roundMoney(acc.debtAccrued + netCredit);
      acc.averagePurchase = acc.purchaseCount
        ? acc.purchaseCost / acc.purchaseCount
        : 0;
      if (p.status === 'voided') acc.voidedPurchases += 1;
      if (p.status === 'returned' || p.status === 'partially_returned') {
        acc.returnedPurchases += 1;
      }
      return acc;
    },
    {
      purchaseCost: 0,
      cashPaidOut: 0,
      cardPaidOut: 0,
      debtAccrued: 0,
      purchaseCount: 0,
      itemCount: 0,
      averagePurchase: 0,
      voidedPurchases: 0,
      returnedPurchases: 0,
      supplierPayments: 0,
      netSupplierDebt: 0,
    },
  );
  summary.supplierPayments = roundMoney(
    supplierPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
  );
  summary.netSupplierDebt = roundMoney(
    summary.debtAccrued - summary.supplierPayments,
  );
  return summary;
}

export function summarizeProductSales(
  bills: Bill[],
  billItems: BillItem[],
  products: Product[],
): ProductSalesRow[] {
  const activeBillIds = new Set(bills.filter((bill) => bill.status !== 'voided').map((bill) => bill.id));
  const productById = new Map(products.map((product) => [product.id, product]));
  const rows = new Map<string, ProductSalesRow>();

  billItems.forEach((item) => {
    if (!activeBillIds.has(item.billId)) return;
    const returnedQuantity = item.quantityReturned ?? 0;
    const netQuantity = Math.max(0, item.quantitySold - returnedQuantity);
    if (netQuantity <= 0) return;

    const key = item.originalProductId || item.barcodeAtSale || item.id;
    const product = productById.get(item.originalProductId);
    const existing = rows.get(key) ?? {
      key,
      name: item.productNameAtSale,
      barcode: item.barcodeAtSale,
      category: item.categoryAtSale,
      quantity: 0,
      revenue: 0,
      profit: 0,
      currentStock: product?.quantityInStock,
      minimumStockAlert: product?.minimumStockAlert,
    };

    existing.quantity += netQuantity;
    existing.revenue = roundMoney(existing.revenue + netQuantity * item.unitSellPriceAtSale);
    existing.profit = roundMoney(existing.profit + netQuantity * (item.unitSellPriceAtSale - item.unitBuyPriceAtSale));
    existing.currentStock = product?.quantityInStock ?? existing.currentStock;
    existing.minimumStockAlert = product?.minimumStockAlert ?? existing.minimumStockAlert;
    rows.set(key, existing);
  });

  return Array.from(rows.values()).sort((a, b) => b.revenue - a.revenue);
}

export function getLowStockSoldProducts(rows: ProductSalesRow[]): ProductSalesRow[] {
  return rows
    .filter((row) => row.currentStock != null && row.minimumStockAlert != null && row.currentStock <= row.minimumStockAlert)
    .sort((a, b) => (a.currentStock ?? 0) - (b.currentStock ?? 0));
}

function trendLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

export function buildDailyTrend(bills: Bill[], days = 7): TrendRow[] {
  const today = startOfDay(new Date());
  const buckets = new Map<string, TrendRow>();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, { label: trendLabel(date), sales: 0, profit: 0, bills: 0 });
  }

  bills.forEach((bill) => {
    const created = new Date(bill.createdAt);
    const key = startOfDay(created).toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) return;
    bucket.sales = roundMoney(bucket.sales + getBillNetTotal(bill));
    bucket.profit = roundMoney(bucket.profit + getBillNetProfit(bill));
    bucket.bills += 1;
  });

  return Array.from(buckets.values());
}

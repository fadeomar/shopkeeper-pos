import type { Bill, BillItem, PaymentMethod, Product } from '@/types/domain';
import { getBillNetProfit, getBillNetTotal } from '@/features/bills/utils/bill-summary';
import { roundMoney } from '@/lib/utils/money';

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

export function summarizeReportBills(bills: Bill[]) {
  return bills.reduce(
    (summary, bill) => {
      const netSales = getBillNetTotal(bill);
      const netProfit = getBillNetProfit(bill);
      summary.billCount += 1;
      summary.itemCount += bill.status === 'voided' ? 0 : bill.itemCount;
      summary.sales += netSales;
      summary.profit += netProfit;
      summary.averageBill = summary.billCount ? summary.sales / summary.billCount : 0;
      // Cash actually retained in the drawer equals net sales for a pure cash
      // bill — overpayment is handed back as change, so paidAmount overstates
      // by exactly that change. Mixed bills cannot be split into cash vs card
      // with the current schema (single paidAmount, no cashAmount/cardAmount),
      // so they are excluded here until the payment-split model lands.
      // TODO(payment-split): include the cashAmount portion of mixed bills.
      if (bill.paymentMethod === 'cash') {
        summary.cashExpected += netSales;
      }
      summary.byPayment[bill.paymentMethod] += netSales;
      if (bill.status === 'voided') summary.voidedBills += 1;
      if (bill.status === 'returned' || bill.status === 'partially_returned') summary.returnedBills += 1;
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

import type { Bill, BillItem, CashMovement, Expense, ExpenseCategory, PaymentMethod, Product, Purchase, Shift, SupplierPayment } from '@/types/domain';
import { getBillNetItemCount, getBillNetProfit, getBillNetTotal } from '@/features/bills/utils/bill-summary';
import { calculateBillItemNetContribution, calculateLineProfit, calculateLineSubtotal } from '@/lib/utils/calculations';
import { roundMoney } from '@/lib/utils/money';
import { localDateKey } from '@/lib/utils/date';
import { netSplitField, normalizeBillSplit } from '@/lib/utils/bill-split';
import { isMiscLine } from '@/lib/utils/misc-items';

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
  // True for the aggregated متفرقات row — all misc lines collapse into one row
  // and contribute no profit (their real cost isn't recorded).
  isMisc?: boolean;
}


export interface CategorySalesRow {
  key: string;
  category: string;
  quantity: number;
  revenue: number;
  profit: number;
}

export interface PartyReportRow {
  key: string;
  name: string;
  phone?: string;
  count: number;
  total: number;
  due: number;
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


export function filterShiftsForReport(shifts: Shift[], filters: ReportFilters): Shift[] {
  const { from, to } = getReportRange(filters);
  return shifts.filter((shift) => {
    const opened = new Date(shift.openedAt);
    const closed = shift.closedAt ? new Date(shift.closedAt) : new Date();
    // Include any shift that overlaps the selected range. A shift can open
    // before midnight and still carry today's drawer-affecting records.
    if (from && closed <= from) return false;
    if (to && opened >= to) return false;
    return true;
  });
}

export function filterExpensesForReport(
  rows: Expense[],
  filters: ReportFilters,
): Expense[] {
  const { from, to } = getReportRange(filters);
  return rows.filter((row) => {
    const dateValue = row.expenseDate || row.createdAt;
    const created = new Date(dateValue);
    if (from && created < from) return false;
    if (to && created >= to) return false;
    return true;
  });
}

export function summarizeReportBills(bills: Bill[]) {
  const summary = bills.reduce(
    (acc, bill) => {
      const billWithSplit = normalizeBillSplit(bill) as Bill;
      const netSales = getBillNetTotal(billWithSplit);
      const netProfit = getBillNetProfit(billWithSplit);
      acc.billCount += 1;
      acc.itemCount += getBillNetItemCount(billWithSplit);
      acc.sales += netSales;
      acc.profit += netProfit;
      // Cash retained = the cashAmount portion of the bill, less the
      // proportional share of any returns/voids. Works for pure cash and the
      // cash leg of mixed bills uniformly, since both populate cashAmount.
      acc.cashExpected += netSplitField(billWithSplit, billWithSplit.cashAmount);
      acc.byPayment[billWithSplit.paymentMethod] += netSales;
      if (billWithSplit.status === 'voided') acc.voidedBills += 1;
      if (billWithSplit.status === 'returned' || billWithSplit.status === 'partially_returned') acc.returnedBills += 1;
      return acc;
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
  // Average bill denominator excludes voided bills — a void contributes $0 to
  // sales but would artificially deflate the average if counted.
  const activeBillCount = summary.billCount - summary.voidedBills;
  summary.averageBill = activeBillCount > 0 ? roundMoney(summary.sales / activeBillCount) : 0;
  return summary;
}

function getPurchaseNetItemCount(purchase: Purchase): number {
  if (purchase.status === 'voided' || purchase.status === 'returned') return 0;
  const itemCount = Number(purchase.itemCount) || 0;
  const total = Number(purchase.totalAmount) || 0;
  if (itemCount <= 0) return 0;
  if (total <= 0) return itemCount;
  const netCost = Math.max(0, total - (purchase.returnedAmount ?? 0));
  return Math.max(0, Math.round(itemCount * (netCost / total)));
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
      const p = normalizeBillSplit(raw);
      const netCost = Math.max(0, p.totalAmount - (p.returnedAmount ?? 0));
      const netCash = netSplitField(p, p.cashAmount);
      const netCard = netSplitField(p, p.cardAmount);
      const netCredit = netSplitField(p, p.creditAmount);
      acc.purchaseCount += 1;
      acc.itemCount += getPurchaseNetItemCount(p as Purchase);
      acc.purchaseCost = roundMoney(acc.purchaseCost + netCost);
      acc.cashPaidOut = roundMoney(acc.cashPaidOut + netCash);
      acc.cardPaidOut = roundMoney(acc.cardPaidOut + netCard);
      acc.debtAccrued = roundMoney(acc.debtAccrued + netCredit);
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
  // Average purchase denominator excludes voided purchases — a void contributes
  // $0 to purchaseCost but would artificially deflate the average if counted.
  const activePurchaseCount = summary.purchaseCount - summary.voidedPurchases;
  summary.averagePurchase = activePurchaseCount > 0 ? roundMoney(summary.purchaseCost / activePurchaseCount) : 0;
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
  const activeBills = bills.filter((bill) => bill.status !== 'voided');
  const activeBillIds = new Set(activeBills.map((bill) => bill.id));
  const billById = new Map(activeBills.map((bill) => [bill.id, bill]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const rows = new Map<string, ProductSalesRow>();

  billItems.forEach((item) => {
    if (!activeBillIds.has(item.billId)) return;
    const returnedQuantity = item.quantityReturned ?? 0;
    const netQuantity = Math.max(0, item.quantitySold - returnedQuantity);
    if (netQuantity <= 0) return;

    const bill = billById.get(item.billId);
    const lineAmount = calculateLineSubtotal(netQuantity, item.unitSellPriceAtSale);
    const lineProfit = calculateLineProfit(netQuantity, item.unitBuyPriceAtSale, item.unitSellPriceAtSale);
    // Allocate the bill's discount and tax proportionally to this line so
    // product-level revenue matches the bill totals reported on the sales page.
    const net = bill
      ? calculateBillItemNetContribution(bill, lineAmount, lineProfit)
      : { revenue: lineAmount, profit: lineProfit };

    // All متفرقات lines collapse into a single "misc" row; real products key
    // by their own id. Misc rows carry no product, no barcode, and no profit.
    const isMisc = isMiscLine(item);
    const key = isMisc ? 'misc' : item.originalProductId || item.barcodeAtSale || item.id;
    const product = isMisc ? undefined : productById.get(item.originalProductId);
    const existing = rows.get(key) ?? {
      key,
      // Misc rows are relabeled with a localized "Misc sales" string at render
      // time (reports-workspace); the snapshot name is kept only as a fallback.
      name: item.productNameAtSale,
      barcode: isMisc ? '—' : item.barcodeAtSale,
      category: item.categoryAtSale,
      quantity: 0,
      revenue: 0,
      profit: 0,
      currentStock: product?.quantityInStock,
      minimumStockAlert: product?.minimumStockAlert,
      isMisc,
    };

    existing.quantity += netQuantity;
    existing.revenue = roundMoney(existing.revenue + net.revenue);
    existing.profit = roundMoney(existing.profit + (isMisc ? 0 : net.profit));
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
    buckets.set(localDateKey(date), { label: trendLabel(date), sales: 0, profit: 0, bills: 0 });
  }

  bills.forEach((bill) => {
    const created = new Date(bill.createdAt);
    const key = localDateKey(startOfDay(created));
    const bucket = buckets.get(key);
    if (!bucket) return;
    bucket.sales = roundMoney(bucket.sales + getBillNetTotal(bill));
    bucket.profit = roundMoney(bucket.profit + getBillNetProfit(bill));
    bucket.bills += 1;
  });

  return Array.from(buckets.values());
}

/**
 * Operational expenses summary.
 *
 *   total           — gross expense total across all categories + methods.
 *   cashPaidOut     — only the cash-tendered expenses (drawer-affecting).
 *   byCategory      — total per category, sorted descending. Used by Z-report
 *                     and the by-category panel on the reports page.
 *   byMethod        — total per payment method.
 *   expenseCount    — number of expense rows in range.
 */
export function summarizeReportExpenses(expenses: Expense[]) {
  const byCategory = new Map<ExpenseCategory, number>();
  const byMethod = { cash: 0, card: 0, bank: 0, credit: 0 } as Record<Expense['paymentMethod'], number>;
  let total = 0;
  let cashPaidOut = 0;
  for (const e of expenses) {
    const amount = Number(e.amount) || 0;
    total += amount;
    if (e.paymentMethod === 'cash') cashPaidOut += amount;
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + amount);
    byMethod[e.paymentMethod] = roundMoney((byMethod[e.paymentMethod] ?? 0) + amount);
  }
  return {
    total: roundMoney(total),
    cashPaidOut: roundMoney(cashPaidOut),
    expenseCount: expenses.length,
    byCategory: Array.from(byCategory.entries())
      .map(([category, amount]) => ({ category, amount: roundMoney(amount) }))
      .sort((a, b) => b.amount - a.amount),
    byMethod,
  };
}

/**
 * Manual cash drawer movements summary. CashMovement.amount is already
 * signed (+ in, − out), so we sum directly and split positive/negative for
 * the Z-report display.
 */
export function summarizeReportCashMovements(movements: CashMovement[]) {
  let cashIn = 0;
  let cashOut = 0;
  for (const m of movements) {
    const amount = Number(m.amount) || 0;
    if (amount >= 0) cashIn += amount;
    else cashOut += amount; // negative
  }
  return {
    cashIn: roundMoney(cashIn),
    cashOut: roundMoney(Math.abs(cashOut)),
    net: roundMoney(cashIn + cashOut),
    count: movements.length,
  };
}


export function summarizeCategorySales(rows: ProductSalesRow[]): CategorySalesRow[] {
  const categories = new Map<string, CategorySalesRow>();
  for (const row of rows) {
    // Misc (متفرقات) rows have no real category and zero profit — they are
    // surfaced via their own stat card + product row, so keep them out of the
    // category breakdown (otherwise they'd collide with / dilute a real
    // user-defined category that happens to share the name).
    if (row.isMisc) continue;
    const category = row.category?.trim() || '—';
    const existing = categories.get(category) ?? {
      key: category,
      category,
      quantity: 0,
      revenue: 0,
      profit: 0,
    };
    existing.quantity += row.quantity;
    existing.revenue = roundMoney(existing.revenue + row.revenue);
    existing.profit = roundMoney(existing.profit + row.profit);
    categories.set(category, existing);
  }
  return Array.from(categories.values()).sort((a, b) => b.revenue - a.revenue);
}

export function summarizeCustomerSales(bills: Bill[]): PartyReportRow[] {
  const rows = new Map<string, PartyReportRow>();
  for (const bill of bills) {
    if (bill.status === 'voided') continue;
    const name = bill.customerName?.trim() || 'Walk-in';
    const key = bill.customerId || bill.customerPhone || name;
    const existing = rows.get(key) ?? {
      key,
      name,
      phone: bill.customerPhone,
      count: 0,
      total: 0,
      due: 0,
    };
    const total = getBillNetTotal(bill);
    existing.count += 1;
    existing.total = roundMoney(existing.total + total);
    existing.due = roundMoney(existing.due + Math.max(0, (bill.creditAmount ?? 0) - (bill.returnedAmount ?? 0)));
    rows.set(key, existing);
  }
  return Array.from(rows.values()).sort((a, b) => b.total - a.total);
}

export function summarizeSupplierPurchases(purchases: Purchase[]): PartyReportRow[] {
  const rows = new Map<string, PartyReportRow>();
  for (const purchase of purchases) {
    if (purchase.status === 'voided') continue;
    const name = purchase.supplierName?.trim() || 'Walk-in supplier';
    const key = purchase.supplierId || purchase.supplierPhone || name;
    const existing = rows.get(key) ?? {
      key,
      name,
      phone: purchase.supplierPhone,
      count: 0,
      total: 0,
      due: 0,
    };
    const netCost = Math.max(0, purchase.totalAmount - (purchase.returnedAmount ?? 0));
    existing.count += 1;
    existing.total = roundMoney(existing.total + netCost);
    existing.due = roundMoney(existing.due + Math.max(0, purchase.creditAmount ?? 0));
    rows.set(key, existing);
  }
  return Array.from(rows.values()).sort((a, b) => b.total - a.total);
}

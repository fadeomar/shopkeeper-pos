import { describe, expect, it, vi } from 'vitest';
import {
  buildDailyTrend,
  filterByDateRange,
  filterBillsForReport,
  filterExpensesForReport,
  getLowStockSoldProducts,
  summarizeCategorySales,
  summarizeCustomerSales,
  summarizeProductSales,
  summarizeReportBills,
  summarizeReportCashMovements,
  summarizeReportExpenses,
  summarizeReportPurchases,
  summarizeSupplierPurchases,
  type ReportFilters,
} from '@/features/reports/utils/report-summary';
import type { Bill, BillItem, CashMovement, Expense, Product, Purchase, SupplierPayment } from '@/types/domain';

function makeBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 'bill-1',
    billNumber: 'INV-000001',
    createdAt: '2026-01-10T10:00:00.000Z',
    cashierName: 'Cashier',
    paymentMethod: 'cash',
    subtotal: 100,
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 100,
    paidAmount: 100,
    changeAmount: 0,
    cashAmount: 100,
    cardAmount: 0,
    creditAmount: 0,
    totalProfit: 35,
    itemCount: 2,
    status: 'finalized',
    ...overrides,
  };
}

function makeBillItem(overrides: Partial<BillItem> = {}): BillItem {
  return {
    id: 'item-1',
    billId: 'bill-1',
    originalProductId: 'product-1',
    barcodeAtSale: '123',
    productNameAtSale: 'Coffee',
    categoryAtSale: 'Drinks',
    itemKind: 'product',
    quantitySold: 2,
    unitBuyPriceAtSale: 3,
    unitSellPriceAtSale: 10,
    lineSubtotal: 20,
    lineProfit: 14,
    createdAt: '2026-01-10T10:00:00.000Z',
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    barcode: '123',
    name: 'Coffee',
    category: 'Drinks',
    unit: 'piece',
    quantityInStock: 4,
    buyPrice: 3,
    sellPrice: 10,
    minimumStockAlert: 5,
    dateAdded: '2026-01-01T00:00:00.000Z',
    lastUpdated: '2026-01-01T00:00:00.000Z',
    status: 'active',
    ...overrides,
  };
}

function makePurchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: 'purchase-1',
    purchaseNumber: 'PO-000001',
    createdAt: '2026-01-10T10:00:00.000Z',
    cashierName: 'Cashier',
    supplierName: 'Supplier',
    supplierPhone: '0599000000',
    paymentMethod: 'cash',
    subtotal: 200,
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 200,
    paidAmount: 200,
    changeAmount: 0,
    cashAmount: 200,
    cardAmount: 0,
    creditAmount: 0,
    itemCount: 4,
    status: 'finalized',
    ...overrides,
  };
}

describe('report-summary date filters', () => {
  it('filters records using inclusive start and exclusive next-day end for custom ranges', () => {
    const rows = [
      { id: 'before', createdAt: '2026-01-09T23:59:59.000Z' },
      { id: 'start', createdAt: '2026-01-10T00:00:00.000Z' },
      { id: 'end-day', createdAt: '2026-01-12T23:59:59.000Z' },
      { id: 'after', createdAt: '2026-01-13T00:00:00.000Z' },
    ];
    const filters: ReportFilters = { range: 'custom', customFrom: '2026-01-10', customTo: '2026-01-12' };

    expect(filterByDateRange(rows, filters).map((row) => row.id)).toEqual(['start', 'end-day']);
    expect(filterBillsForReport(rows.map((row) => makeBill({ id: row.id, createdAt: row.createdAt })), filters).map((bill) => bill.id)).toEqual(['start', 'end-day']);
  });

  it('filters expenses by expenseDate before falling back to createdAt', () => {
    const expenses: Expense[] = [
      { id: 'rent', category: 'rent', amount: 100, paymentMethod: 'cash', expenseDate: '2026-01-11', createdAt: '2026-02-01T00:00:00.000Z' },
      { id: 'internet', category: 'internet', amount: 50, paymentMethod: 'bank', createdAt: '2026-02-01T00:00:00.000Z' },
    ];

    expect(filterExpensesForReport(expenses, { range: 'custom', customFrom: '2026-01-10', customTo: '2026-01-12' }).map((e) => e.id)).toEqual(['rent']);
  });
});

describe('report-summary sales and purchase summaries', () => {
  it('summarizes sales net of returns/voids and cash drawer impact', () => {
    const bills = [
      makeBill({ id: 'cash', totalAmount: 100, cashAmount: 100, totalProfit: 30, itemCount: 2 }),
      makeBill({ id: 'card', paymentMethod: 'card', totalAmount: 80, cashAmount: 0, cardAmount: 80, totalProfit: 20, itemCount: 1 }),
      makeBill({ id: 'credit', paymentMethod: 'credit', totalAmount: 50, paidAmount: 10, cashAmount: 10, creditAmount: 40, totalProfit: 10, itemCount: 1 }),
      makeBill({ id: 'returned', totalAmount: 40, cashAmount: 40, totalProfit: 12, itemCount: 4, returnedAmount: 10, returnedProfit: 3, status: 'partially_returned' }),
      makeBill({ id: 'voided', totalAmount: 60, cashAmount: 60, totalProfit: 18, itemCount: 3, returnedAmount: 60, returnedProfit: 18, status: 'voided' }),
    ];

    const summary = summarizeReportBills(bills);

    expect(summary).toMatchObject({
      sales: 260,
      profit: 69,
      billCount: 5,
      itemCount: 7,
      cashExpected: 140,
      voidedBills: 1,
      returnedBills: 1,
      averageBill: 65,
    });
    expect(summary.byPayment).toMatchObject({ cash: 130, card: 80, credit: 50, mixed: 0 });
  });

  it('summarizes purchases, supplier payments, and supplier debt net change', () => {
    const purchases = [
      makePurchase({ id: 'cash', totalAmount: 200, cashAmount: 200, itemCount: 4 }),
      makePurchase({ id: 'card', paymentMethod: 'card', totalAmount: 120, cashAmount: 0, cardAmount: 120, itemCount: 3 }),
      makePurchase({ id: 'credit', paymentMethod: 'credit', totalAmount: 90, paidAmount: 20, cashAmount: 20, creditAmount: 70, itemCount: 3 }),
      makePurchase({ id: 'returned', totalAmount: 50, cashAmount: 50, returnedAmount: 10, itemCount: 5, status: 'partially_returned' }),
      makePurchase({ id: 'voided', totalAmount: 100, cashAmount: 100, returnedAmount: 100, itemCount: 2, status: 'voided' }),
    ];
    const supplierPayments: SupplierPayment[] = [
      { id: 'pay-1', supplierKey: 'supplier', supplierName: 'Supplier', amount: 30, createdAt: '2026-01-10T12:00:00.000Z' },
    ];

    const summary = summarizeReportPurchases(purchases, supplierPayments);

    expect(summary).toMatchObject({
      purchaseCost: 450,
      cashPaidOut: 260,
      cardPaidOut: 120,
      debtAccrued: 70,
      purchaseCount: 5,
      itemCount: 14,
      voidedPurchases: 1,
      returnedPurchases: 1,
      supplierPayments: 30,
      netSupplierDebt: 40,
      averagePurchase: 112.5,
    });
  });
});

describe('report-summary product, category, and party reports', () => {
  it('summarizes product sales, collapses misc rows, skips voided bills, and flags low-stock sold products', () => {
    const bills = [makeBill({ id: 'bill-1' }), makeBill({ id: 'bill-void', status: 'voided' })];
    const items = [
      makeBillItem({ id: 'coffee-1', billId: 'bill-1', originalProductId: 'product-1', quantitySold: 3, quantityReturned: 1, unitSellPriceAtSale: 10, unitBuyPriceAtSale: 4 }),
      makeBillItem({ id: 'misc-1', billId: 'bill-1', originalProductId: 'misc_snacks', barcodeAtSale: 'MISC', productNameAtSale: 'متفرقات - Candy', categoryAtSale: 'Misc', itemKind: 'misc', quantitySold: 2, unitSellPriceAtSale: 3, unitBuyPriceAtSale: 0, lineSubtotal: 6, lineProfit: 0 }),
      makeBillItem({ id: 'voided-item', billId: 'bill-void', originalProductId: 'product-1', quantitySold: 99, unitSellPriceAtSale: 10 }),
    ];
    const rows = summarizeProductSales(bills, items, [makeProduct({ quantityInStock: 4, minimumStockAlert: 5 })]);

    expect(rows).toEqual([
      expect.objectContaining({ key: 'product-1', name: 'Coffee', quantity: 2, revenue: 20, profit: 12, currentStock: 4, minimumStockAlert: 5 }),
      expect.objectContaining({ key: 'misc', name: 'متفرقات', quantity: 2, revenue: 6, profit: 0, isMisc: true }),
    ]);
    expect(getLowStockSoldProducts(rows).map((row) => row.key)).toEqual(['product-1']);
    expect(summarizeCategorySales(rows)).toEqual([
      expect.objectContaining({ category: 'Drinks', quantity: 2, revenue: 20, profit: 12 }),
      expect.objectContaining({ category: 'Misc', quantity: 2, revenue: 6, profit: 0 }),
    ]);
  });

  it('summarizes customer sales and supplier purchases while ignoring voided records', () => {
    const customerRows = summarizeCustomerSales([
      makeBill({ id: 'walk-in', customerName: '', customerPhone: undefined, totalAmount: 20, creditAmount: 0 }),
      makeBill({ id: 'ali-1', customerId: 'cust-1', customerName: 'Ali', customerPhone: '0599', paymentMethod: 'credit', totalAmount: 50, creditAmount: 35 }),
      makeBill({ id: 'ali-2', customerId: 'cust-1', customerName: 'Ali New', customerPhone: '0599', paymentMethod: 'credit', totalAmount: 70, creditAmount: 70, returnedAmount: 10 }),
      makeBill({ id: 'voided', customerName: 'Ali', totalAmount: 999, creditAmount: 999, status: 'voided' }),
    ]);

    expect(customerRows).toEqual([
      expect.objectContaining({ key: 'cust-1', name: 'Ali', phone: '0599', count: 2, total: 110, due: 95 }),
      expect.objectContaining({ key: 'Walk-in', name: 'Walk-in', count: 1, total: 20, due: 0 }),
    ]);

    const supplierRows = summarizeSupplierPurchases([
      makePurchase({ id: 'supplier-1', supplierId: 'sup-1', supplierName: 'Supplier', totalAmount: 200, creditAmount: 120 }),
      makePurchase({ id: 'supplier-2', supplierId: 'sup-1', supplierName: 'Supplier Updated', totalAmount: 100, returnedAmount: 25, creditAmount: 100 }),
      makePurchase({ id: 'voided', supplierName: 'Supplier', totalAmount: 999, creditAmount: 999, status: 'voided' }),
    ]);

    expect(supplierRows).toEqual([
      expect.objectContaining({ key: 'sup-1', name: 'Supplier', count: 2, total: 275, due: 195 }),
    ]);
  });
});

describe('report-summary cash operations and trends', () => {
  it('summarizes expenses by category/method and cash movements by signed amount', () => {
    const expenses: Expense[] = [
      { id: 'rent', category: 'rent', amount: 100, paymentMethod: 'cash', createdAt: '2026-01-10T10:00:00.000Z' },
      { id: 'net', category: 'internet', amount: 40, paymentMethod: 'bank', createdAt: '2026-01-10T10:00:00.000Z' },
      { id: 'rent-2', category: 'rent', amount: 50, paymentMethod: 'card', createdAt: '2026-01-10T10:00:00.000Z' },
    ];
    const movements: CashMovement[] = [
      { id: 'in', type: 'cash_in', amount: 25, createdAt: '2026-01-10T10:00:00.000Z' },
      { id: 'out', type: 'cash_out', amount: -10, createdAt: '2026-01-10T11:00:00.000Z' },
      { id: 'correction', type: 'drawer_correction', amount: -5, createdAt: '2026-01-10T12:00:00.000Z' },
    ];

    expect(summarizeReportExpenses(expenses)).toEqual({
      total: 190,
      cashPaidOut: 100,
      expenseCount: 3,
      byCategory: [
        { category: 'rent', amount: 150 },
        { category: 'internet', amount: 40 },
      ],
      byMethod: { cash: 100, card: 50, bank: 40, credit: 0 },
    });
    expect(summarizeReportCashMovements(movements)).toEqual({ cashIn: 25, cashOut: 15, net: 10, count: 3 });
  });

  it('builds daily sales trends from the last N local days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'));

    const trend = buildDailyTrend([
      makeBill({ id: 'jan-8', createdAt: '2026-01-08T10:00:00.000Z', totalAmount: 20, totalProfit: 5 }),
      makeBill({ id: 'jan-10', createdAt: '2026-01-10T09:00:00.000Z', totalAmount: 30, totalProfit: 8 }),
      makeBill({ id: 'old', createdAt: '2026-01-01T09:00:00.000Z', totalAmount: 999, totalProfit: 999 }),
    ], 3);

    expect(trend).toHaveLength(3);
    expect(trend.map((row) => ({ sales: row.sales, profit: row.profit, bills: row.bills }))).toEqual([
      { sales: 20, profit: 5, bills: 1 },
      { sales: 0, profit: 0, bills: 0 },
      { sales: 30, profit: 8, bills: 1 },
    ]);
  });
});

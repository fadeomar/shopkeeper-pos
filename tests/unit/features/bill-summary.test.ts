import { describe, expect, it, vi } from 'vitest';
import { filterBills, summarizeBills, type BillFilters } from '@/features/bills/utils/bill-summary';
import type { Bill } from '@/types/domain';

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
    totalProfit: 30,
    itemCount: 2,
    status: 'finalized',
    ...overrides,
  };
}

const baseFilters: BillFilters = {
  query: '',
  dateFilter: 'all',
  paymentFilter: 'all',
  statusFilter: 'all',
  cashierFilter: 'all',
  customFrom: '',
  customTo: '',
};

describe('bill-summary filtering', () => {
  it('filters by query, payment method, status, cashier, and custom date range', () => {
    const bills = [
      makeBill({ id: 'match', billNumber: 'INV-000010', createdAt: '2026-01-10T10:00:00.000Z', customerName: 'Ali Market', cashierName: 'Mona', paymentMethod: 'credit', status: 'partially_returned' }),
      makeBill({ id: 'wrong-date', billNumber: 'INV-000011', createdAt: '2026-01-20T10:00:00.000Z', customerName: 'Ali Market', cashierName: 'Mona', paymentMethod: 'credit', status: 'partially_returned' }),
      makeBill({ id: 'wrong-payment', billNumber: 'INV-000012', createdAt: '2026-01-10T10:00:00.000Z', customerName: 'Ali Market', cashierName: 'Mona', paymentMethod: 'cash', status: 'partially_returned' }),
      makeBill({ id: 'wrong-cashier', billNumber: 'INV-000013', createdAt: '2026-01-10T10:00:00.000Z', customerName: 'Ali Market', cashierName: 'Nour', paymentMethod: 'credit', status: 'partially_returned' }),
    ];

    const result = filterBills(bills, {
      ...baseFilters,
      query: 'ali',
      dateFilter: 'custom',
      customFrom: '2026-01-10',
      customTo: '2026-01-10',
      paymentFilter: 'credit',
      statusFilter: 'partially_returned',
      cashierFilter: 'Mona',
    });

    expect(result.map((bill) => bill.id)).toEqual(['match']);
  });

  it('supports relative date filters based on the current local day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'));
    const bills = [
      makeBill({ id: 'today', createdAt: '2026-01-10T01:00:00.000Z' }),
      makeBill({ id: 'yesterday', createdAt: '2026-01-09T23:00:00.000Z' }),
    ];

    expect(filterBills(bills, { ...baseFilters, dateFilter: 'today' }).map((bill) => bill.id)).toEqual(['today']);
    expect(filterBills(bills, { ...baseFilters, dateFilter: 'yesterday' }).map((bill) => bill.id)).toEqual(['yesterday']);
  });
});

describe('bill-summary aggregation', () => {
  it('summarizes net sales/profit and paid cash/card amounts without treating credit debt as paid', () => {
    const summary = summarizeBills([
      makeBill({ id: 'cash', paymentMethod: 'cash', totalAmount: 100, cashAmount: 100, totalProfit: 30, itemCount: 2 }),
      makeBill({ id: 'card', paymentMethod: 'card', totalAmount: 80, cashAmount: 0, cardAmount: 80, totalProfit: 20, itemCount: 1 }),
      makeBill({ id: 'credit', paymentMethod: 'credit', totalAmount: 60, paidAmount: 15, cashAmount: 15, creditAmount: 45, totalProfit: 12, itemCount: 1 }),
      makeBill({ id: 'returned', paymentMethod: 'cash', totalAmount: 40, cashAmount: 40, returnedAmount: 10, returnedProfit: 3, totalProfit: 10, itemCount: 4, status: 'partially_returned' }),
      makeBill({ id: 'voided', paymentMethod: 'cash', totalAmount: 50, cashAmount: 50, returnedAmount: 50, returnedProfit: 10, totalProfit: 10, itemCount: 5, status: 'voided' }),
    ]);

    expect(summary).toMatchObject({
      billCount: 5,
      itemCount: 7,
      totalSales: 270,
      totalProfit: 69,
      totalPaid: 225,
    });
    expect(summary.byPayment).toEqual({ cash: 130, card: 80, credit: 60, mixed: 0 });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorCode } from '@/lib/errors/app-error';
import { db } from '@/lib/db/schema';
import { makeBillDraftItem, makeBillForm, makePurchaseDraftItem, makePurchaseForm } from '@/tests/helpers/builders';
import { resetTestDb, seedProduct, seedSettings } from '@/tests/helpers/db';

vi.mock('@/lib/services/subscription-service', () => ({
  assertSubscriptionCanWrite: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/permission-service', () => ({
  assertPermission: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/audit-service', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

const { createFinalizedBill, returnBillItem, voidBill } = await import('@/lib/services/billing-service');
const { createFinalizedPurchase } = await import('@/lib/services/purchase-service');
const { recordCustomerPayment } = await import('@/lib/services/customer-ledger-service');
const { recordSupplierPayment } = await import('@/lib/services/supplier-ledger-service');
const { recordCashMovement } = await import('@/lib/services/cash-movement-service');
const { recordExpense } = await import('@/lib/services/expense-service');
const { closeShift, computeExpectedCash, getActiveShift, openShift, summarizeShiftCash } = await import(
  '@/lib/services/shift-service'
);

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('shift and cash drawer integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestDb();
    await seedSettings({ requireShift: true });
  });

  it('opens one active shift, queues it for sync, and blocks a second open shift', async () => {
    const shift = await openShift({ openingCash: 100, cashierName: 'Mona', notes: 'Morning drawer' });

    expect(shift).toMatchObject({
      openedByCashierName: 'Mona',
      openingCash: 100,
      notes: 'Morning drawer',
      status: 'open',
      syncStatus: 'pending',
    });
    await expect(getActiveShift()).resolves.toMatchObject({ id: shift.id });
    await expect(db.syncQueue.get(`sq:shift:${shift.id}`)).resolves.toMatchObject({
      entity: 'shift',
      operation: 'create',
      status: 'pending',
    });
    await expectAppError(
      openShift({ openingCash: 10, cashierName: 'Second cashier' }),
      AppErrorCode.SHIFT_ALREADY_OPEN,
    );
  });

  it('enforces requireShift for cash-affecting writes before an open shift exists', async () => {
    const product = await seedProduct({ quantityInStock: 10, sellPrice: 8, buyPrice: 3 });

    await expectAppError(
      createFinalizedBill({
        items: [makeBillDraftItem(product, { quantity: 1 })],
        form: makeBillForm({ paidAmount: 8 }),
      }),
      AppErrorCode.BILL_SHIFT_REQUIRED,
    );
    await expectAppError(
      createFinalizedPurchase({
        items: [makePurchaseDraftItem(product, { quantity: 1, unitCost: 3 })],
        form: makePurchaseForm({ paidAmount: 3 }),
      }),
      AppErrorCode.SHIFT_REQUIRED_FOR_CASH_ACTION,
    );
    await expectAppError(
      recordCustomerPayment({ customerKey: 'cust-1', customerName: 'Customer', amount: 2 }),
      AppErrorCode.SHIFT_REQUIRED_FOR_CASH_ACTION,
    );
    await expectAppError(
      recordSupplierPayment({ supplierKey: 'supp-1', supplierName: 'Supplier', amount: 2 }),
      AppErrorCode.SHIFT_REQUIRED_FOR_CASH_ACTION,
    );
    await expectAppError(
      recordCashMovement({ type: 'cash_in', amount: 5, reason: 'Float top-up' }),
      AppErrorCode.SHIFT_REQUIRED_FOR_CASH_ACTION,
    );
    await expectAppError(
      recordExpense({ category: 'rent', amount: 5, paymentMethod: 'cash' }),
      AppErrorCode.SHIFT_REQUIRED_FOR_CASH_ACTION,
    );

    await expect(db.bills.count()).resolves.toBe(0);
    await expect(db.purchases.count()).resolves.toBe(0);
    await expect(db.customerPayments.count()).resolves.toBe(0);
    await expect(db.supplierPayments.count()).resolves.toBe(0);
    await expect(db.cashMovements.count()).resolves.toBe(0);
    await expect(db.expenses.count()).resolves.toBe(0);
  });

  it('computes expected cash from sales, customer payments, purchases, supplier payments, movements, and cash expenses', async () => {
    const shift = await openShift({ openingCash: 100, cashierName: 'Cashier' });
    const product = await seedProduct({ quantityInStock: 30, buyPrice: 3, sellPrice: 8 });

    const cashBill = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 2, unitSellPrice: 8, unitBuyPrice: 3 })],
      form: makeBillForm({ paidAmount: 20 }),
    });
    const cardBill = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 1, unitSellPrice: 8, unitBuyPrice: 3 })],
      form: makeBillForm({ paymentMethod: 'card', paidAmount: 0 }),
    });
    const purchase = await createFinalizedPurchase({
      items: [makePurchaseDraftItem(product, { quantity: 2, unitCost: 5 })],
      form: makePurchaseForm({ paidAmount: 10 }),
    });
    const customerPayment = await recordCustomerPayment({
      customerKey: 'cust-1',
      customerName: 'Customer',
      amount: 7,
    });
    const supplierPayment = await recordSupplierPayment({
      supplierKey: 'supp-1',
      supplierName: 'Supplier',
      amount: 4,
    });
    const cashIn = await recordCashMovement({ type: 'cash_in', amount: 20, reason: 'Float top-up' });
    const cashOut = await recordCashMovement({ type: 'owner_withdrawal', amount: 5, reason: 'Owner draw' });
    const cashExpense = await recordExpense({ category: 'transport', amount: 6, paymentMethod: 'cash' });
    const cardExpense = await recordExpense({ category: 'internet', amount: 99, paymentMethod: 'card' });

    expect(cashBill.bill.shiftId).toBe(shift.id);
    expect(cardBill.bill.shiftId).toBe(shift.id);
    expect(purchase.purchase.shiftId).toBe(shift.id);
    expect(customerPayment.shiftId).toBe(shift.id);
    expect(supplierPayment.shiftId).toBe(shift.id);
    expect(cashIn.shiftId).toBe(shift.id);
    expect(cashOut).toMatchObject({ shiftId: shift.id, amount: -5 });
    expect(cashExpense.shiftId).toBe(shift.id);
    expect(cardExpense.shiftId).toBe(shift.id);

    const summary = await computeExpectedCash(shift);
    expect(summary).toMatchObject({
      openingCash: 100,
      customerPaymentCashIn: 7,
      cashMovementNet: 15,
      cashExpensesTotal: 6,
      expectedCash: 118,
    });
    expect(summary.totals).toMatchObject({
      cashCollected: 16,
      cardCollected: 8,
      creditAccrued: 0,
      netSales: 24,
      billCount: 2,
      itemCount: 3,
    });
    expect(summary.cashOut).toMatchObject({
      purchaseCashOut: 10,
      supplierPaymentCashOut: 4,
      totalCashOut: 14,
      purchaseCount: 1,
      supplierPaymentCount: 1,
    });

    const closed = await closeShift({ shiftId: shift.id, countedCash: 116, notes: 'Short by 2' });
    expect(closed).toMatchObject({
      status: 'closed',
      expectedCash: 118,
      countedCash: 116,
      cashDifference: -2,
      closingNotes: 'Short by 2',
      syncStatus: 'pending',
    });
    await expect(getActiveShift()).resolves.toBeNull();
    await expect(db.syncQueue.get(`sq:shift:${shift.id}`)).resolves.toMatchObject({
      entity: 'shift',
      operation: 'upsert',
      status: 'pending',
    });
  });

  it('uses the same pure summary helper for proportional returns and non-cash payments', () => {
    const summary = summarizeShiftCash(
      { openingCash: 50 },
      {
        bills: [
          {
            id: 'bill-1',
            billNumber: 'INV-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            paymentMethod: 'cash',
            subtotal: 20,
            discountAmount: 0,
            taxAmount: 0,
            totalAmount: 20,
            paidAmount: 20,
            changeAmount: 0,
            cashAmount: 20,
            cardAmount: 0,
            creditAmount: 0,
            totalProfit: 10,
            itemCount: 4,
            status: 'partially_returned',
            returnedAmount: 5,
            returnedProfit: 2.5,
          },
          {
            id: 'bill-2',
            billNumber: 'INV-2',
            createdAt: '2026-01-01T00:01:00.000Z',
            paymentMethod: 'credit',
            subtotal: 30,
            discountAmount: 0,
            taxAmount: 0,
            totalAmount: 30,
            paidAmount: 10,
            changeAmount: 0,
            cashAmount: 10,
            cardAmount: 0,
            creditAmount: 20,
            totalProfit: 12,
            itemCount: 3,
            status: 'finalized',
          },
        ],
        purchases: [
          {
            id: 'purchase-1',
            purchaseNumber: 'PO-1',
            createdAt: '2026-01-01T00:02:00.000Z',
            paymentMethod: 'cash',
            subtotal: 40,
            discountAmount: 0,
            taxAmount: 0,
            totalAmount: 40,
            paidAmount: 40,
            changeAmount: 0,
            cashAmount: 40,
            cardAmount: 0,
            creditAmount: 0,
            itemCount: 4,
            status: 'partially_returned',
            returnedAmount: 10,
          },
          {
            id: 'purchase-2',
            purchaseNumber: 'PO-2',
            createdAt: '2026-01-01T00:03:00.000Z',
            paymentMethod: 'card',
            subtotal: 99,
            discountAmount: 0,
            taxAmount: 0,
            totalAmount: 99,
            paidAmount: 99,
            changeAmount: 0,
            cashAmount: 0,
            cardAmount: 99,
            creditAmount: 0,
            itemCount: 1,
            status: 'finalized',
          },
        ],
        customerPayments: [
          { id: 'cp-1', customerKey: 'cust', customerName: 'Customer', amount: 4, paymentMethod: 'cash', createdAt: 'x' },
          { id: 'cp-2', customerKey: 'cust', customerName: 'Customer', amount: 9, paymentMethod: 'card', createdAt: 'x' },
        ],
        supplierPayments: [
          { id: 'sp-1', supplierKey: 'supp', supplierName: 'Supplier', amount: 3, paymentMethod: 'cash', createdAt: 'x' },
          { id: 'sp-2', supplierKey: 'supp', supplierName: 'Supplier', amount: 8, paymentMethod: 'bank', createdAt: 'x' },
        ],
        cashMovements: [{ id: 'cm-1', type: 'cash_out', amount: -2, createdAt: 'x' }],
        expenses: [
          { id: 'exp-1', category: 'rent', amount: 6, paymentMethod: 'cash', createdAt: 'x' },
          { id: 'exp-2', category: 'internet', amount: 11, paymentMethod: 'card', createdAt: 'x' },
        ],
      },
    );

    expect(summary.totals).toMatchObject({
      cashCollected: 25,
      creditAccrued: 20,
      netSales: 45,
      returnedBillCount: 1,
      itemCount: 6,
    });
    expect(summary.cashOut).toMatchObject({ purchaseCashOut: 30, supplierPaymentCashOut: 3, totalCashOut: 33 });
    expect(summary).toMatchObject({ customerPaymentCashIn: 4, cashMovementNet: -2, cashExpensesTotal: 6, expectedCash: 38 });
  });

  it('locks finalized records that belong to a closed shift', async () => {
    const shift = await openShift({ openingCash: 0, cashierName: 'Cashier' });
    const product = await seedProduct({ quantityInStock: 5, buyPrice: 2, sellPrice: 5 });
    const sale = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 1, unitBuyPrice: 2, unitSellPrice: 5 })],
      form: makeBillForm({ paidAmount: 5 }),
    });
    const [item] = sale.billItems;
    await closeShift({ shiftId: shift.id, countedCash: 5 });

    await expectAppError(
      voidBill({ billId: sale.bill.id, reason: 'Late correction' }),
      AppErrorCode.CLOSED_SHIFT_RECORD_LOCKED,
    );
    await expectAppError(
      returnBillItem({ billId: sale.bill.id, itemId: item.id, quantity: 1, reason: 'Late return' }),
      AppErrorCode.CLOSED_SHIFT_RECORD_LOCKED,
    );
    await expectAppError(
      recordCustomerPayment({
        customerKey: 'cust-1',
        customerName: 'Customer',
        amount: 1,
        shiftId: shift.id,
      }),
      AppErrorCode.CLOSED_SHIFT_RECORD_LOCKED,
    );
  });
});

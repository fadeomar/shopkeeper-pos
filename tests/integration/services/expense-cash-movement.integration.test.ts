import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorCode } from '@/lib/errors/app-error';
import { db } from '@/lib/db/schema';
import { resetTestDb, seedSettings } from '@/tests/helpers/db';

vi.mock('@/lib/services/subscription-service', () => ({
  assertSubscriptionCanWrite: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/audit-service', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

const { openShift } = await import('@/lib/services/shift-service');
const { recordExpense, listExpenses, getShiftCashExpensesTotal } = await import('@/lib/services/expense-service');
const { recordCashMovement, listCashMovements, getShiftCashMovementNet } = await import(
  '@/lib/services/cash-movement-service'
);
const { logAudit } = await import('@/lib/services/audit-service');

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('expense and cash movement integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestDb();
    await seedSettings({ requireShift: false });
  });

  it('records an expense with trimmed snapshots, rounding, sync queue, and audit metadata', async () => {
    const expense = await recordExpense({
      category: 'internet',
      amount: 12.345,
      paymentMethod: 'bank',
      payee: '  PalTel  ',
      note: '  monthly router bill  ',
      cashierName: '  Mona  ',
      expenseDate: '2026-01-15',
    });

    expect(expense).toMatchObject({
      category: 'internet',
      amount: 12.35,
      paymentMethod: 'bank',
      payee: 'PalTel',
      note: 'monthly router bill',
      cashierName: 'Mona',
      expenseDate: '2026-01-15',
      syncStatus: 'pending',
    });
    expect(expense.shiftId).toBeUndefined();
    await expect(db.expenses.get(expense.id)).resolves.toMatchObject({ id: expense.id, amount: 12.35 });
    await expect(db.syncQueue.get(`sq:expense:${expense.id}`)).resolves.toMatchObject({
      entity: 'expense',
      operation: 'create',
      status: 'pending',
    });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      category: 'expense',
      action: 'expense_create',
      entityId: expense.id,
      entityLabel: 'internet — PalTel',
      summary: '12.35 (bank)',
      reason: 'monthly router bill',
    }));
  });

  it('validates expense amount and only requires an open shift for cash expenses', async () => {
    await seedSettings({ requireShift: true });

    await expectAppError(
      recordExpense({ category: 'rent', amount: 0, paymentMethod: 'cash' }),
      AppErrorCode.PAYMENT_AMOUNT_INVALID,
    );
    await expectAppError(
      recordExpense({ category: 'rent', amount: Number.NaN, paymentMethod: 'cash' }),
      AppErrorCode.PAYMENT_AMOUNT_INVALID,
    );
    await expectAppError(
      recordExpense({ category: 'rent', amount: 10, paymentMethod: 'cash' }),
      AppErrorCode.SHIFT_REQUIRED_FOR_CASH_ACTION,
    );

    const cardExpense = await recordExpense({ category: 'internet', amount: 10, paymentMethod: 'card' });
    const bankExpense = await recordExpense({ category: 'fees', amount: 11, paymentMethod: 'bank' });
    const creditExpense = await recordExpense({ category: 'maintenance', amount: 12, paymentMethod: 'credit' });

    expect(cardExpense.shiftId).toBeUndefined();
    expect(bankExpense.shiftId).toBeUndefined();
    expect(creditExpense.shiftId).toBeUndefined();
    await expect(db.expenses.count()).resolves.toBe(3);
  });

  it('attaches expenses to the active shift and sums only cash expenses for drawer close math', async () => {
    await seedSettings({ requireShift: true });
    const shift = await openShift({ openingCash: 40, cashierName: 'Cashier' });

    const cashExpense = await recordExpense({ category: 'transport', amount: 7.25, paymentMethod: 'cash' });
    const cardExpense = await recordExpense({ category: 'internet', amount: 99, paymentMethod: 'card' });
    const bankExpense = await recordExpense({ category: 'fees', amount: 3, paymentMethod: 'bank' });
    const creditExpense = await recordExpense({ category: 'maintenance', amount: 4, paymentMethod: 'credit' });

    expect(cashExpense.shiftId).toBe(shift.id);
    expect(cardExpense.shiftId).toBe(shift.id);
    expect(bankExpense.shiftId).toBe(shift.id);
    expect(creditExpense.shiftId).toBe(shift.id);
    await expect(getShiftCashExpensesTotal(shift.id)).resolves.toBe(7.25);
    await expect(getShiftCashExpensesTotal('')).resolves.toBe(0);
  });

  it('lists expenses by category, method, shift, search text, created date, and limit', async () => {
    const shift = await openShift({ openingCash: 0, cashierName: 'Cashier' });
    await db.expenses.bulkAdd([
      {
        id: 'old-rent',
        category: 'rent',
        amount: 100,
        paymentMethod: 'cash',
        payee: 'Landlord',
        note: 'January rent',
        shiftId: shift.id,
        createdAt: '2026-01-01T09:00:00.000Z',
        syncStatus: 'pending',
      },
      {
        id: 'new-internet',
        category: 'internet',
        amount: 50,
        paymentMethod: 'bank',
        payee: 'PalTel',
        note: 'Fiber line',
        createdAt: '2026-01-03T09:00:00.000Z',
        syncStatus: 'pending',
      },
      {
        id: 'new-rent',
        category: 'rent',
        amount: 90,
        paymentMethod: 'card',
        payee: 'Office owner',
        note: 'February rent',
        createdAt: '2026-01-02T09:00:00.000Z',
        syncStatus: 'pending',
      },
    ]);

    await expect(listExpenses({ category: 'rent' })).resolves.toEqual([
      expect.objectContaining({ id: 'new-rent' }),
      expect.objectContaining({ id: 'old-rent' }),
    ]);
    await expect(listExpenses({ paymentMethod: 'bank' })).resolves.toEqual([
      expect.objectContaining({ id: 'new-internet' }),
    ]);
    await expect(listExpenses({ shiftId: shift.id })).resolves.toEqual([
      expect.objectContaining({ id: 'old-rent' }),
    ]);
    await expect(listExpenses({ search: 'fiber' })).resolves.toEqual([
      expect.objectContaining({ id: 'new-internet' }),
    ]);
    await expect(listExpenses({ from: '2026-01-02T00:00:00.000Z', to: '2026-01-03T23:59:59.999Z' }, 1)).resolves.toEqual([
      expect.objectContaining({ id: 'new-internet' }),
    ]);
  });

  it('records signed manual cash movements with sync queue and audit entries', async () => {
    const cashIn = await recordCashMovement({
      type: 'cash_in',
      amount: 25.555,
      reason: '  float top-up  ',
      referenceLabel: '  Owner Ali  ',
      cashierName: '  Mona  ',
    });
    const ownerWithdrawal = await recordCashMovement({ type: 'owner_withdrawal', amount: 10, reason: 'Owner draw' });
    const cashOutNegativeInput = await recordCashMovement({ type: 'cash_out', amount: -6, reason: 'Payout' });
    const positiveCorrection = await recordCashMovement({ type: 'drawer_correction', amount: 2.25, reason: 'Found cash' });
    const negativeCorrection = await recordCashMovement({ type: 'drawer_correction', amount: -1.5, reason: 'Missing cash' });

    expect(cashIn).toMatchObject({ amount: 25.56, reason: 'float top-up', referenceLabel: 'Owner Ali', cashierName: 'Mona' });
    expect(ownerWithdrawal.amount).toBe(-10);
    expect(cashOutNegativeInput.amount).toBe(-6);
    expect(positiveCorrection.amount).toBe(2.25);
    expect(negativeCorrection.amount).toBe(-1.5);
    await expect(db.syncQueue.get(`sq:cashMovement:${cashIn.id}`)).resolves.toMatchObject({
      entity: 'cashMovement',
      operation: 'create',
      status: 'pending',
    });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      category: 'cash',
      action: 'cash_in',
      entityId: cashIn.id,
      entityLabel: 'Owner Ali',
      summary: 'cash_in: +25.56',
      reason: 'float top-up',
    }));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      category: 'cash',
      action: 'cash_out',
      entityId: ownerWithdrawal.id,
      summary: 'owner_withdrawal: -10',
    }));
  });

  it('validates cash movement amount and respects requireShift for every manual drawer event', async () => {
    await seedSettings({ requireShift: true });

    await expectAppError(
      recordCashMovement({ type: 'cash_in', amount: 0, reason: 'No-op' }),
      AppErrorCode.PAYMENT_AMOUNT_INVALID,
    );
    await expectAppError(
      recordCashMovement({ type: 'cash_in', amount: Number.POSITIVE_INFINITY, reason: 'Bad' }),
      AppErrorCode.PAYMENT_AMOUNT_INVALID,
    );
    await expectAppError(
      recordCashMovement({ type: 'cash_in', amount: 5, reason: 'Needs shift' }),
      AppErrorCode.SHIFT_REQUIRED_FOR_CASH_ACTION,
    );

    const shift = await openShift({ openingCash: 5, cashierName: 'Cashier' });
    const movement = await recordCashMovement({ type: 'bank_deposit', amount: 3, reason: 'Deposit' });
    expect(movement).toMatchObject({ shiftId: shift.id, amount: -3 });
  });

  it('sums and lists manual cash movements by signed drawer effect', async () => {
    const shift = await openShift({ openingCash: 0, cashierName: 'Cashier' });
    await db.cashMovements.bulkAdd([
      {
        id: 'old-in',
        type: 'cash_in',
        amount: 20,
        shiftId: shift.id,
        reason: 'top-up',
        createdAt: '2026-01-01T09:00:00.000Z',
        syncStatus: 'pending',
      },
      {
        id: 'new-out',
        type: 'bank_deposit',
        amount: -7,
        shiftId: shift.id,
        reason: 'deposit',
        createdAt: '2026-01-03T09:00:00.000Z',
        syncStatus: 'pending',
      },
      {
        id: 'other-shift',
        type: 'cash_out',
        amount: -99,
        shiftId: 'other-shift',
        createdAt: '2026-01-02T09:00:00.000Z',
        syncStatus: 'pending',
      },
    ]);

    await expect(getShiftCashMovementNet(shift.id)).resolves.toBe(13);
    await expect(getShiftCashMovementNet('')).resolves.toBe(0);
    await expect(listCashMovements({ shiftId: shift.id })).resolves.toEqual([
      expect.objectContaining({ id: 'new-out' }),
      expect.objectContaining({ id: 'old-in' }),
    ]);
    await expect(listCashMovements({ type: 'cash_out' })).resolves.toEqual([
      expect.objectContaining({ id: 'other-shift' }),
    ]);
    await expect(listCashMovements({ from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T23:59:59.999Z' }, 1)).resolves.toEqual([
      expect.objectContaining({ id: 'other-shift' }),
    ]);
  });
});

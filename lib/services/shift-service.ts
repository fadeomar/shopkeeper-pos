import { AppError, AppErrorCode } from '@/lib/errors/app-error';
import { db } from '@/lib/db/schema';
import { nowIso } from '@/lib/utils/date';
import { createId } from '@/lib/utils/id';
import { netSplitField, normalizeBillSplit } from '@/lib/utils/bill-split';
import { roundMoney } from '@/lib/utils/money';
import { getBillNetItemCount } from '@/features/bills/utils/bill-summary';
import { buildSyncQueueItem } from '@/lib/services/sync-queue-service';
import { logAudit } from '@/lib/services/audit-service';
import type { Bill, CashMovement, CustomerPayment, Expense, Purchase, Shift, SupplierPayment } from '@/types/domain';

function requestSync(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('shopkeeper:sync-requested'));
  }
}

/** Returns the single open shift on this device, or null if none. */
export async function getActiveShift(): Promise<Shift | null> {
  const open = await db.shifts.where('status').equals('open').first();
  return open ?? null;
}

/**
 * Tender breakdown for a single shift: net retained per payment method, after
 * proportional return allocation. Mirrors the report-summary math so the
 * shift screen agrees with the reports page for the same bills.
 */
export interface ShiftTenderTotals {
  cashCollected: number;
  cardCollected: number;
  creditAccrued: number;
  netSales: number;
  billCount: number;
  voidedBillCount: number;
  returnedBillCount: number;
  itemCount: number;
}

export function summarizeShiftBills(bills: Bill[]): ShiftTenderTotals {
  return bills.reduce<ShiftTenderTotals>(
    (acc, raw) => {
      const bill = normalizeBillSplit(raw) as Bill;
      const cash = netSplitField(bill, bill.cashAmount);
      const card = netSplitField(bill, bill.cardAmount);
      const credit = netSplitField(bill, bill.creditAmount);
      acc.cashCollected = roundMoney(acc.cashCollected + cash);
      acc.cardCollected = roundMoney(acc.cardCollected + card);
      acc.creditAccrued = roundMoney(acc.creditAccrued + credit);
      acc.netSales = roundMoney(acc.netSales + cash + card + credit);
      acc.billCount += 1;
      if (bill.status === 'voided') acc.voidedBillCount += 1;
      if (bill.status === 'returned' || bill.status === 'partially_returned') {
        acc.returnedBillCount += 1;
      }
      acc.itemCount += getBillNetItemCount(bill);
      return acc;
    },
    {
      cashCollected: 0,
      cardCollected: 0,
      creditAccrued: 0,
      netSales: 0,
      billCount: 0,
      voidedBillCount: 0,
      returnedBillCount: 0,
      itemCount: 0,
    },
  );
}

/**
 * Cash-out side of the drawer for one shift: purchases paid in cash + supplier
 * payments. Both reduce expectedCash at close. We use the same proportional
 * return allocation for purchases that bills get, so a returned-to-supplier
 * line correctly puts cash back into the drawer.
 */
export interface ShiftCashOutTotals {
  purchaseCashOut: number;
  supplierPaymentCashOut: number;
  totalCashOut: number;
  purchaseCount: number;
  supplierPaymentCount: number;
}

export function summarizeShiftCashOut(
  purchases: Purchase[],
  supplierPayments: SupplierPayment[],
): ShiftCashOutTotals {
  let purchaseCashOut = 0;
  for (const raw of purchases) {
    // Purchases share the bill split shape — same netSplitField helper.
    const p = normalizeBillSplit(raw as unknown as Bill) as unknown as Purchase;
    purchaseCashOut += netSplitField(p as unknown as Bill, p.cashAmount);
  }
  // Only cash supplier payments leave the drawer. Card/bank payments are
  // settled outside the cash drawer. Undefined paymentMethod is treated as
  // cash for backwards compatibility with records created before this field.
  const supplierPaymentCashOut = supplierPayments
    .filter((p) => !p.paymentMethod || p.paymentMethod === 'cash')
    .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  return {
    purchaseCashOut: roundMoney(purchaseCashOut),
    supplierPaymentCashOut: roundMoney(supplierPaymentCashOut),
    totalCashOut: roundMoney(purchaseCashOut + supplierPaymentCashOut),
    purchaseCount: purchases.length,
    supplierPaymentCount: supplierPayments.length,
  };
}

/** All shiftId-filtered records that feed a shift's drawer math. */
export interface ShiftCashRecords {
  bills: Bill[];
  purchases: Purchase[];
  supplierPayments: SupplierPayment[];
  customerPayments: CustomerPayment[];
  cashMovements: CashMovement[];
  expenses: Expense[];
}

export interface ShiftCashSummary {
  openingCash: number;
  totals: ShiftTenderTotals;
  cashOut: ShiftCashOutTotals;
  customerPaymentCashIn: number;
  cashMovementNet: number;
  cashExpensesTotal: number;
  expectedCash: number;
}

/**
 * SINGLE SOURCE OF TRUTH for a shift's drawer math. The active Shift screen,
 * computeExpectedCash(), and closeShift() all funnel their (shiftId-filtered)
 * records through this one pure function, so the live summary can never diverge
 * from the final close-shift calculation again.
 *
 * Expected cash for a shift:
 *   openingCash + cashCollected (from bills, net of returns)
 *               + customerPaymentCashIn (cash debt payments from customers)
 *               − purchaseCashOut (cash leg of purchases, net of returns)
 *               − supplierPaymentCashOut (debt-settlement payments in cash)
 *               + cashMovementNet (manual drawer events, already signed)
 *               − cashExpensesTotal (operational expenses paid in cash)
 */
export function summarizeShiftCash(
  shift: Pick<Shift, 'openingCash'>,
  records: ShiftCashRecords,
): ShiftCashSummary {
  const totals = summarizeShiftBills(records.bills);
  const cashOut = summarizeShiftCashOut(records.purchases, records.supplierPayments);
  const customerPaymentCashIn = roundMoney(
    records.customerPayments
      .filter((p) => !p.paymentMethod || p.paymentMethod === 'cash')
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
  );
  // CashMovement.amount is already signed (+ in, − out), so a plain sum is the
  // net drawer effect.
  const cashMovementNet = roundMoney(
    records.cashMovements.reduce((sum, m) => sum + (Number(m.amount) || 0), 0),
  );
  // Only cash-tendered expenses affect the drawer. Card/bank/credit are
  // accounted for elsewhere or settle later, so they're ignored here.
  const cashExpensesTotal = roundMoney(
    records.expenses
      .filter((e) => e.paymentMethod === 'cash')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
  );
  return {
    openingCash: shift.openingCash,
    totals,
    cashOut,
    customerPaymentCashIn,
    cashMovementNet,
    cashExpensesTotal,
    expectedCash: roundMoney(
      shift.openingCash +
        totals.cashCollected +
        customerPaymentCashIn -
        cashOut.totalCashOut +
        cashMovementNet -
        cashExpensesTotal,
    ),
  };
}

/** Fetch a shift's records (filtered by shiftId) and summarize its drawer math. */
export async function computeExpectedCash(shift: Shift): Promise<ShiftCashSummary> {
  const [bills, purchases, supplierPayments, customerPayments, cashMovements, expenses] = await Promise.all([
    db.bills.where('shiftId').equals(shift.id).toArray(),
    db.purchases.where('shiftId').equals(shift.id).toArray(),
    db.supplierPayments.where('shiftId').equals(shift.id).toArray(),
    db.customerPayments.where('shiftId').equals(shift.id).toArray(),
    db.cashMovements.where('shiftId').equals(shift.id).toArray(),
    db.expenses.where('shiftId').equals(shift.id).toArray(),
  ]);
  return summarizeShiftCash(shift, {
    bills,
    purchases,
    supplierPayments,
    customerPayments,
    cashMovements,
    expenses,
  });
}

export async function openShift(input: {
  openingCash: number;
  cashierName: string;
  notes?: string;
}): Promise<Shift> {
  const openingCash = Number(input.openingCash);
  if (!Number.isFinite(openingCash) || openingCash < 0) {
    throw new AppError(AppErrorCode.SHIFT_OPENING_CASH_NEGATIVE);
  }
  const cashierName = input.cashierName.trim() || 'Owner';

  const shift = await db.transaction('rw', [db.shifts, db.syncQueue], async () => {
    const existing = await db.shifts.where('status').equals('open').first();
    if (existing) {
      throw new AppError(AppErrorCode.SHIFT_ALREADY_OPEN);
    }

    const now = nowIso();
    const nextShift: Shift = {
      id: createId('shift'),
      openedAt: now,
      openedByCashierName: cashierName,
      openingCash: roundMoney(openingCash),
      notes: input.notes?.trim() || undefined,
      status: 'open',
      syncStatus: 'pending',
    };

    await db.shifts.add(nextShift);
    await db.syncQueue.put(
      buildSyncQueueItem({
        entity: 'shift',
        entityId: nextShift.id,
        operation: 'create',
      }),
    );

    return nextShift;
  });

  requestSync();
  void logAudit({
    category: 'shift',
    action: 'open',
    entityId: shift.id,
    entityLabel: cashierName,
    summary: `opening cash: ${shift.openingCash}`,
    reason: shift.notes,
    shiftId: shift.id,
  });
  return shift;
}

export async function closeShift(input: {
  shiftId: string;
  countedCash: number;
  notes?: string;
}): Promise<Shift> {
  const countedCash = Number(input.countedCash);
  if (!Number.isFinite(countedCash) || countedCash < 0) {
    throw new AppError(AppErrorCode.SHIFT_COUNTED_CASH_NEGATIVE);
  }

  const closedShift = await db.transaction(
    'rw',
    [db.shifts, db.bills, db.purchases, db.supplierPayments, db.customerPayments, db.cashMovements, db.expenses, db.syncQueue],
    async () => {
      const shift = await db.shifts.get(input.shiftId);
      if (!shift) throw new AppError(AppErrorCode.SHIFT_NOT_FOUND);
      if (shift.status === 'closed') throw new AppError(AppErrorCode.SHIFT_ALREADY_CLOSED);

      const [bills, purchases, supplierPayments, customerPayments, cashMovements, expenses] = await Promise.all([
        db.bills.where('shiftId').equals(shift.id).toArray(),
        db.purchases.where('shiftId').equals(shift.id).toArray(),
        db.supplierPayments.where('shiftId').equals(shift.id).toArray(),
        db.customerPayments.where('shiftId').equals(shift.id).toArray(),
        db.cashMovements.where('shiftId').equals(shift.id).toArray(),
        db.expenses.where('shiftId').equals(shift.id).toArray(),
      ]);
      // Same shared helper the active Shift screen uses — guarantees the close
      // calculation matches the live summary the cashier was just looking at.
      const { expectedCash } = summarizeShiftCash(shift, {
        bills,
        purchases,
        supplierPayments,
        customerPayments,
        cashMovements,
        expenses,
      });
      const safeCounted = roundMoney(countedCash);

      const nextClosedShift: Shift = {
        ...shift,
        status: 'closed',
        closedAt: nowIso(),
        expectedCash,
        countedCash: safeCounted,
        cashDifference: roundMoney(safeCounted - expectedCash),
        closingNotes: input.notes?.trim() || undefined,
        syncStatus: 'pending',
        lastSyncError: undefined,
      };

      await db.shifts.put(nextClosedShift);
      await db.syncQueue.put(
        buildSyncQueueItem({
          entity: 'shift',
          entityId: nextClosedShift.id,
          operation: 'upsert',
        }),
      );

      return nextClosedShift;
    },
  );

  requestSync();
  void logAudit({
    category: 'shift',
    action: 'close',
    entityId: closedShift.id,
    entityLabel: closedShift.openedByCashierName,
    summary: `expected ${closedShift.expectedCash} / counted ${closedShift.countedCash} / diff ${closedShift.cashDifference}`,
    reason: closedShift.closingNotes,
    shiftId: closedShift.id,
  });
  return closedShift;
}

export async function listShifts(): Promise<Shift[]> {
  return db.shifts.orderBy('openedAt').reverse().toArray();
}

export async function getShift(id: string): Promise<Shift | null> {
  return (await db.shifts.get(id)) ?? null;
}

export async function getShiftBills(id: string): Promise<Bill[]> {
  return db.bills.where('shiftId').equals(id).toArray();
}

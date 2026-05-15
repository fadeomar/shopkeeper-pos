import { db } from '@/lib/db/schema';
import { nowIso } from '@/lib/utils/date';
import { createId } from '@/lib/utils/id';
import { netSplitField, normalizeBillSplit } from '@/lib/utils/bill-split';
import { roundMoney } from '@/lib/utils/money';
import { buildSyncQueueItem } from '@/lib/services/sync-queue-service';
import type { Bill, Purchase, Shift, SupplierPayment } from '@/types/domain';

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
      acc.itemCount += bill.status === 'voided' ? 0 : bill.itemCount;
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
  const supplierPaymentCashOut = supplierPayments.reduce(
    (sum, payment) => sum + (Number(payment.amount) || 0),
    0,
  );
  return {
    purchaseCashOut: roundMoney(purchaseCashOut),
    supplierPaymentCashOut: roundMoney(supplierPaymentCashOut),
    totalCashOut: roundMoney(purchaseCashOut + supplierPaymentCashOut),
    purchaseCount: purchases.length,
    supplierPaymentCount: supplierPayments.length,
  };
}

/**
 * Expected cash for a shift:
 *   openingCash + cashCollected (from bills, net of returns)
 *                − purchaseCashOut (cash leg of purchases, net of returns)
 *                − supplierPaymentCashOut (debt-settlement payments in cash)
 */
export async function computeExpectedCash(shift: Shift): Promise<{
  expectedCash: number;
  totals: ShiftTenderTotals;
  cashOut: ShiftCashOutTotals;
}> {
  const [bills, purchases, supplierPayments] = await Promise.all([
    db.bills.where('shiftId').equals(shift.id).toArray(),
    db.purchases.where('shiftId').equals(shift.id).toArray(),
    db.supplierPayments.where('shiftId').equals(shift.id).toArray(),
  ]);
  const totals = summarizeShiftBills(bills);
  const cashOut = summarizeShiftCashOut(purchases, supplierPayments);
  return {
    expectedCash: roundMoney(
      shift.openingCash + totals.cashCollected - cashOut.totalCashOut,
    ),
    totals,
    cashOut,
  };
}

export async function openShift(input: {
  openingCash: number;
  cashierName: string;
  notes?: string;
}): Promise<Shift> {
  const openingCash = Number(input.openingCash);
  if (!Number.isFinite(openingCash) || openingCash < 0) {
    throw new Error('Opening cash must be zero or greater.');
  }
  const cashierName = input.cashierName.trim() || 'Owner';

  return db.transaction('rw', [db.shifts, db.syncQueue], async () => {
    const existing = await db.shifts.where('status').equals('open').first();
    if (existing) {
      throw new Error('A shift is already open on this device. Close it before opening a new one.');
    }

    const now = nowIso();
    const shift: Shift = {
      id: createId('shift'),
      openedAt: now,
      openedByCashierName: cashierName,
      openingCash: roundMoney(openingCash),
      notes: input.notes?.trim() || undefined,
      status: 'open',
      syncStatus: 'pending',
    };

    await db.shifts.add(shift);
    await db.syncQueue.put(
      buildSyncQueueItem({
        entity: 'shift',
        entityId: shift.id,
        operation: 'create',
      }),
    );

    requestSync();
    return shift;
  });
}

export async function closeShift(input: {
  shiftId: string;
  countedCash: number;
  notes?: string;
}): Promise<Shift> {
  const countedCash = Number(input.countedCash);
  if (!Number.isFinite(countedCash) || countedCash < 0) {
    throw new Error('Counted cash must be zero or greater.');
  }

  return db.transaction(
    'rw',
    [db.shifts, db.bills, db.purchases, db.supplierPayments, db.syncQueue],
    async () => {
    const shift = await db.shifts.get(input.shiftId);
    if (!shift) throw new Error('Shift not found.');
    if (shift.status === 'closed') throw new Error('Shift is already closed.');

    const [bills, purchases, supplierPayments] = await Promise.all([
      db.bills.where('shiftId').equals(shift.id).toArray(),
      db.purchases.where('shiftId').equals(shift.id).toArray(),
      db.supplierPayments.where('shiftId').equals(shift.id).toArray(),
    ]);
    const totals = summarizeShiftBills(bills);
    const cashOut = summarizeShiftCashOut(purchases, supplierPayments);
    const expectedCash = roundMoney(
      shift.openingCash + totals.cashCollected - cashOut.totalCashOut,
    );
    const safeCounted = roundMoney(countedCash);

    const closedShift: Shift = {
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

    await db.shifts.put(closedShift);
    await db.syncQueue.put(
      buildSyncQueueItem({
        entity: 'shift',
        entityId: closedShift.id,
        operation: 'upsert',
      }),
    );

    requestSync();
    return closedShift;
  },
  );
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

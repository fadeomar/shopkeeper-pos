import { db } from '@/lib/db/schema';
import { nowIso } from '@/lib/utils/date';
import { createId } from '@/lib/utils/id';
import { roundMoney } from '@/lib/utils/money';
import { AppError, AppErrorCode } from '@/lib/errors/app-error';
import { buildSyncQueueItem } from '@/lib/services/sync-queue-service';
import { logAudit } from '@/lib/services/audit-service';
import type { CashMovement, CashMovementType } from '@/types/domain';

/**
 * Sign convention: positive amount = into drawer, negative = out of drawer.
 * We accept a positive magnitude from the UI and apply the sign based on the
 * movement type, so the caller never has to reason about it.
 *
 * `drawer_correction` is the exception — it can be either direction. The UI
 * sends a signed value for that type, and we accept it as-is.
 */
const INFLOW_TYPES: CashMovementType[] = ['cash_in'];
const OUTFLOW_TYPES: CashMovementType[] = ['cash_out', 'owner_withdrawal', 'bank_deposit', 'petty_cash'];

function signFor(type: CashMovementType, magnitude: number): number {
  if (type === 'drawer_correction') return magnitude; // already signed
  if (INFLOW_TYPES.includes(type)) return Math.abs(magnitude);
  if (OUTFLOW_TYPES.includes(type)) return -Math.abs(magnitude);
  return magnitude;
}

export interface RecordCashMovementInput {
  type: CashMovementType;
  /** Magnitude (or signed for drawer_correction). Will be rejected if 0. */
  amount: number;
  reason?: string;
  referenceLabel?: string;
  cashierName?: string;
}

/**
 * Record a manual drawer event. Always attaches to the current open shift
 * (if any) so closeShift can fold it into the expected-cash math without
 * a follow-up update.
 */
export async function recordCashMovement(input: RecordCashMovementInput): Promise<CashMovement> {
  const magnitude = Number(input.amount);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    // Reuse the generic payment-amount error code — same semantic ("must be
    // a nonzero number") and the message generalises cleanly.
    throw new AppError(AppErrorCode.PAYMENT_AMOUNT_INVALID);
  }

  const now = nowIso();
  const activeShift = await db.shifts.where('status').equals('open').first();
  const signedAmount = roundMoney(signFor(input.type, magnitude));

  const movement: CashMovement = {
    id: createId('cash'),
    type: input.type,
    amount: signedAmount,
    reason: input.reason?.trim() || undefined,
    referenceLabel: input.referenceLabel?.trim() || undefined,
    shiftId: activeShift?.id,
    cashierName: input.cashierName?.trim() || undefined,
    createdAt: now,
    syncStatus: 'pending',
  };

  await db.transaction('rw', [db.cashMovements, db.syncQueue], async () => {
    await db.cashMovements.add(movement);
    await db.syncQueue.put(
      buildSyncQueueItem({
        entity: 'cashMovement',
        entityId: movement.id,
        operation: 'create',
      }),
    );
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('shopkeeper:sync-requested'));
  }

  void logAudit({
    category: 'shift',
    action: signedAmount > 0 ? 'open' : 'close', // best-fit existing actions; audit only logs the cash event itself
    entityId: movement.id,
    entityLabel: input.referenceLabel || input.type,
    summary: `${input.type}: ${signedAmount > 0 ? '+' : ''}${signedAmount}`,
    reason: movement.reason,
    shiftId: movement.shiftId,
  });

  return movement;
}

export interface CashMovementFilters {
  type?: CashMovementType;
  shiftId?: string;
  from?: string;
  to?: string;
}

export async function listCashMovements(filters: CashMovementFilters = {}, limit = 500): Promise<CashMovement[]> {
  let collection;
  if (filters.shiftId) {
    collection = db.cashMovements.where('shiftId').equals(filters.shiftId);
  } else if (filters.type) {
    collection = db.cashMovements.where('type').equals(filters.type);
  } else {
    collection = db.cashMovements.toCollection();
  }

  let rows = await collection.toArray();
  if (filters.type) rows = rows.filter((r) => r.type === filters.type);
  if (filters.shiftId) rows = rows.filter((r) => r.shiftId === filters.shiftId);
  if (filters.from) rows = rows.filter((r) => r.createdAt >= filters.from!);
  if (filters.to) rows = rows.filter((r) => r.createdAt <= filters.to!);

  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows.slice(0, limit);
}

/**
 * Net cash effect of all manual movements within a shift. Used by closeShift
 * to fold drawer events into the expected-cash calculation.
 *
 * Returns the signed sum — positive means the drawer should have more cash
 * because of these events; negative means less.
 */
export async function getShiftCashMovementNet(shiftId: string): Promise<number> {
  if (!shiftId) return 0;
  const rows = await db.cashMovements.where('shiftId').equals(shiftId).toArray();
  return roundMoney(rows.reduce((sum, row) => sum + row.amount, 0));
}

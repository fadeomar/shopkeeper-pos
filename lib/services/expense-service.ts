import { db } from '@/lib/db/schema';
import { nowIso } from '@/lib/utils/date';
import { createId } from '@/lib/utils/id';
import { roundMoney } from '@/lib/utils/money';
import { AppError, AppErrorCode } from '@/lib/errors/app-error';
import { SETTINGS_ID } from '@/lib/db/repositories';
import { buildSyncQueueItem } from '@/lib/services/sync-queue-service';
import { logAudit } from '@/lib/services/audit-service';
import type { Expense, ExpenseCategory, ExpensePaymentMethod } from '@/types/domain';

export interface RecordExpenseInput {
  category: ExpenseCategory;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  payee?: string;
  note?: string;
  cashierName?: string;
  expenseDate?: string;
}

export async function recordExpense(input: RecordExpenseInput): Promise<Expense> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError(AppErrorCode.PAYMENT_AMOUNT_INVALID);
  }

  const now = nowIso();
  const [settings, activeShift] = await Promise.all([
    db.settings.get(SETTINGS_ID),
    db.shifts.where('status').equals('open').first(),
  ]);
  if (settings?.requireShift && input.paymentMethod === 'cash' && !activeShift) {
    throw new AppError(AppErrorCode.SHIFT_REQUIRED_FOR_CASH_ACTION);
  }

  const expense: Expense = {
    id: createId('exp'),
    category: input.category,
    amount: roundMoney(amount),
    paymentMethod: input.paymentMethod,
    payee: input.payee?.trim() || undefined,
    note: input.note?.trim() || undefined,
    cashierName: input.cashierName?.trim() || undefined,
    expenseDate: input.expenseDate || undefined,
    shiftId: activeShift?.id,
    createdAt: now,
    syncStatus: 'pending',
  };

  await db.transaction('rw', [db.expenses, db.syncQueue], async () => {
    await db.expenses.add(expense);
    await db.syncQueue.put(
      buildSyncQueueItem({
        entity: 'expense',
        entityId: expense.id,
        operation: 'create',
      }),
    );
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('shopkeeper:sync-requested'));
  }

  void logAudit({
    category: 'expense',
    action: 'expense_create',
    entityId: expense.id,
    entityLabel: `${expense.category}${expense.payee ? ` — ${expense.payee}` : ''}`,
    summary: `${expense.amount} (${expense.paymentMethod})`,
    reason: expense.note,
    shiftId: expense.shiftId,
  });

  return expense;
}

export interface ExpenseFilters {
  category?: ExpenseCategory;
  paymentMethod?: ExpensePaymentMethod;
  shiftId?: string;
  from?: string;
  to?: string;
  search?: string;
}

export async function listExpenses(filters: ExpenseFilters = {}, limit = 500): Promise<Expense[]> {
  let collection;
  if (filters.shiftId) {
    collection = db.expenses.where('shiftId').equals(filters.shiftId);
  } else if (filters.category) {
    collection = db.expenses.where('category').equals(filters.category);
  } else if (filters.paymentMethod) {
    collection = db.expenses.where('paymentMethod').equals(filters.paymentMethod);
  } else {
    collection = db.expenses.toCollection();
  }

  let rows = await collection.toArray();
  if (filters.category) rows = rows.filter((r) => r.category === filters.category);
  if (filters.paymentMethod) rows = rows.filter((r) => r.paymentMethod === filters.paymentMethod);
  if (filters.shiftId) rows = rows.filter((r) => r.shiftId === filters.shiftId);
  if (filters.from) rows = rows.filter((r) => r.createdAt >= filters.from!);
  if (filters.to) rows = rows.filter((r) => r.createdAt <= filters.to!);
  if (filters.search) {
    const q = filters.search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [r.payee, r.note, r.category].filter(Boolean).some((f) => String(f).toLowerCase().includes(q)),
      );
    }
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows.slice(0, limit);
}

/**
 * Sum of cash expenses belonging to a given shift — used by closeShift in
 * the expected-cash math. Card / bank / credit expenses don't touch the
 * drawer so they're excluded here.
 */
export async function getShiftCashExpensesTotal(shiftId: string): Promise<number> {
  if (!shiftId) return 0;
  const rows = await db.expenses.where('shiftId').equals(shiftId).toArray();
  return roundMoney(
    rows
      .filter((r) => r.paymentMethod === 'cash')
      .reduce((sum, r) => sum + r.amount, 0),
  );
}

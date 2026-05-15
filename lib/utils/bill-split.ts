import type { Bill, PaymentMethod } from '@/types/domain';

export interface BillSplit {
  cashAmount: number;
  cardAmount: number;
  creditAmount: number;
}

/**
 * Derive the cash/card/credit split for a pre-v6 bill that lacks the split
 * fields. Used by the Dexie v6 upgrade migration and by the cloud-pull path
 * when older devices push bills written under the legacy single-paidAmount
 * model.
 *
 * Legacy 'mixed' bills never captured how much was cash vs card, so we
 * default them to all-cash. The user has been told via the migration toast.
 */
export function deriveLegacySplit(
  paymentMethod: PaymentMethod,
  totalAmount: number,
  paidAmount: number,
): BillSplit {
  const total = Number.isFinite(totalAmount) ? Math.max(0, totalAmount) : 0;
  const paid = Number.isFinite(paidAmount) ? Math.max(0, paidAmount) : 0;
  switch (paymentMethod) {
    case 'cash':
      return { cashAmount: total, cardAmount: 0, creditAmount: 0 };
    case 'card':
      return { cashAmount: 0, cardAmount: total, creditAmount: 0 };
    case 'mixed':
      return { cashAmount: total, cardAmount: 0, creditAmount: 0 };
    case 'credit': {
      const deposit = Math.min(paid, total);
      return { cashAmount: deposit, cardAmount: 0, creditAmount: total - deposit };
    }
  }
}

/**
 * Fill in cashAmount/cardAmount/creditAmount on a bill that may have come
 * from an older device (cloud pull) and is missing the split fields. Returns
 * the bill object unmodified when the split is already present.
 */
export function normalizeBillSplit<T extends Partial<Bill>>(bill: T): T & BillSplit {
  if (
    typeof bill.cashAmount === 'number' &&
    typeof bill.cardAmount === 'number' &&
    typeof bill.creditAmount === 'number'
  ) {
    return bill as T & BillSplit;
  }
  const derived = deriveLegacySplit(
    (bill.paymentMethod ?? 'cash') as PaymentMethod,
    bill.totalAmount ?? 0,
    bill.paidAmount ?? 0,
  );
  return { ...bill, ...derived };
}

/**
 * For reports / drawer reconciliation: proportionally allocate a bill's
 * returned amount across one of its split fields. Returns the bill's
 * net contribution to that field after returns.
 *
 * Voided bills set returnedAmount = totalAmount, so the formula naturally
 * yields 0 for them.
 */
export function netSplitField(bill: Bill, fieldAmount: number): number {
  if (fieldAmount <= 0 || bill.totalAmount <= 0) return 0;
  const returned = bill.returnedAmount ?? 0;
  if (returned <= 0) return fieldAmount;
  const allocatedReturn = returned * (fieldAmount / bill.totalAmount);
  return Math.max(0, fieldAmount - allocatedReturn);
}

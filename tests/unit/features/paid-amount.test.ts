import { describe, expect, it } from 'vitest';
import {
  creditAwareDefaultPaidAmount,
  resolveActualPaidAmount,
  wasPaidAmountManuallyEdited,
} from '@/features/bills/utils/paid-amount';

describe('creditAwareDefaultPaidAmount', () => {
  it('defaults credit sales/purchases to 0 regardless of total', () => {
    expect(creditAwareDefaultPaidAmount('credit', 250)).toBe(0);
  });

  it('defaults non-credit payments to the full total, rounded to two decimals', () => {
    expect(creditAwareDefaultPaidAmount('cash', 12.5)).toBe(12.5);
    expect(creditAwareDefaultPaidAmount('card', 12.345)).toBe(12.35);
  });

  it('treats a non-finite total as 0', () => {
    expect(creditAwareDefaultPaidAmount('cash', Number.NaN)).toBe(0);
  });
});

describe('wasPaidAmountManuallyEdited', () => {
  it('is false when a recovered credit draft kept the default 0 paid amount', () => {
    expect(wasPaidAmountManuallyEdited(0, 'credit', 100)).toBe(false);
  });

  it('is true when a credit draft carries a non-zero deposit', () => {
    expect(wasPaidAmountManuallyEdited(40, 'credit', 100)).toBe(true);
  });

  it('is false when a non-credit draft equals the auto-filled total', () => {
    expect(wasPaidAmountManuallyEdited(100, 'cash', 100)).toBe(false);
  });

  it('is true when a non-credit draft differs from the total beyond the epsilon', () => {
    expect(wasPaidAmountManuallyEdited(80, 'cash', 100)).toBe(true);
  });

  it('ignores sub-epsilon float noise', () => {
    expect(wasPaidAmountManuallyEdited(100.0005, 'cash', 100)).toBe(false);
  });

  it('treats an undefined saved amount as 0', () => {
    expect(wasPaidAmountManuallyEdited(undefined, 'credit', 100)).toBe(false);
    expect(wasPaidAmountManuallyEdited(undefined, 'cash', 100)).toBe(true);
  });
});

describe('resolveActualPaidAmount', () => {
  it('uses the cashier value when manually edited', () => {
    expect(resolveActualPaidAmount(true, 55, 100)).toBe(55);
  });

  it('falls back to the default when not edited', () => {
    expect(resolveActualPaidAmount(false, 55, 100)).toBe(100);
  });
});

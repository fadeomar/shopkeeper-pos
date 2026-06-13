import { describe, expect, it } from 'vitest';
import { deriveLegacySplit, netSplitField, normalizeBillSplit } from '@/lib/utils/bill-split';

describe('deriveLegacySplit', () => {
  it('puts the whole total in the matching field for single-method payments', () => {
    expect(deriveLegacySplit('cash', 100, 100)).toEqual({ cashAmount: 100, cardAmount: 0, creditAmount: 0 });
    expect(deriveLegacySplit('card', 80, 80)).toEqual({ cashAmount: 0, cardAmount: 80, creditAmount: 0 });
  });

  it('treats legacy mixed bills as all-cash since the cash/card breakdown was never captured', () => {
    expect(deriveLegacySplit('mixed', 60, 60)).toEqual({ cashAmount: 60, cardAmount: 0, creditAmount: 0 });
  });

  it('splits credit bills into the paid deposit (cash) and the outstanding credit', () => {
    expect(deriveLegacySplit('credit', 100, 30)).toEqual({ cashAmount: 30, cardAmount: 0, creditAmount: 70 });
  });

  it('caps the credit deposit at the total so overpayment never produces negative credit', () => {
    expect(deriveLegacySplit('credit', 50, 80)).toEqual({ cashAmount: 50, cardAmount: 0, creditAmount: 0 });
  });

  it('clamps non-finite or negative inputs to zero', () => {
    expect(deriveLegacySplit('cash', Number.NaN, 10)).toEqual({ cashAmount: 0, cardAmount: 0, creditAmount: 0 });
    expect(deriveLegacySplit('credit', -100, Number.POSITIVE_INFINITY)).toEqual({ cashAmount: 0, cardAmount: 0, creditAmount: 0 });
  });
});

describe('normalizeBillSplit', () => {
  it('returns the record unchanged when all three split fields are already present', () => {
    const bill = { cashAmount: 5, cardAmount: 10, creditAmount: 15, paymentMethod: 'mixed', totalAmount: 30 };
    expect(normalizeBillSplit(bill)).toBe(bill);
  });

  it('derives the split from payment method/total/paid when the fields are missing', () => {
    const legacy = { paymentMethod: 'credit', totalAmount: 100, paidAmount: 40 };
    expect(normalizeBillSplit(legacy)).toEqual({
      paymentMethod: 'credit',
      totalAmount: 100,
      paidAmount: 40,
      cashAmount: 40,
      cardAmount: 0,
      creditAmount: 60,
    });
  });

  it('still derives when only some split fields are present (partial is not trusted)', () => {
    const partial = { cashAmount: 5, paymentMethod: 'cash', totalAmount: 20, paidAmount: 20 };
    expect(normalizeBillSplit(partial)).toMatchObject({ cashAmount: 20, cardAmount: 0, creditAmount: 0 });
  });
});

describe('netSplitField', () => {
  it('returns the full field amount when there are no returns', () => {
    expect(netSplitField({ totalAmount: 100, returnedAmount: 0 }, 100)).toBe(100);
  });

  it('returns 0 for non-positive field amounts or non-positive totals', () => {
    expect(netSplitField({ totalAmount: 100 }, 0)).toBe(0);
    expect(netSplitField({ totalAmount: 0 }, 50)).toBe(0);
  });

  it('proportionally allocates returns across the field', () => {
    // total 100, returned 40, cash field 60 -> allocated 40 * 0.6 = 24 -> net 36
    expect(netSplitField({ totalAmount: 100, returnedAmount: 40 }, 60)).toBeCloseTo(36, 6);
  });

  it('nets to 0 for voided bills where returnedAmount equals totalAmount', () => {
    expect(netSplitField({ totalAmount: 100, returnedAmount: 100, status: 'voided' }, 100)).toBe(0);
  });

  it('never returns a negative contribution even if returns exceed the field share', () => {
    expect(netSplitField({ totalAmount: 100, returnedAmount: 200 }, 50)).toBe(0);
  });
});

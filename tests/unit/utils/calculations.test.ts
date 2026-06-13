import { describe, expect, it } from 'vitest';
import {
  calculateBillItemNetContribution,
  calculateBillTotals,
  calculateChange,
  calculateLineGrossProfit,
  calculateLineSubtotal,
} from '@/lib/utils/calculations';

describe('bill calculations', () => {
  it('calculates line subtotal and gross profit using money-safe helpers', () => {
    expect(calculateLineSubtotal(3, 2.35)).toBe(7.05);
    expect(calculateLineGrossProfit(3, 1.1, 2.35)).toBe(3.75);
  });

  it('calculates bill totals, with discount reducing profit and tax excluded from profit', () => {
    const totals = calculateBillTotals(
      [
        { quantity: 2, unitBuyPrice: 4, unitSellPrice: 7 },
        { quantity: 1, unitBuyPrice: 5, unitSellPrice: 10 },
      ],
      3,
      1.5,
    );

    expect(totals.subtotal).toBe(24);
    expect(totals.totalAmount).toBe(22.5);
    expect(totals.totalProfit).toBe(8);
  });

  it('calculates change as paid minus total', () => {
    expect(calculateChange(25, 22.5)).toBe(2.5);
    expect(calculateChange(20, 22.5)).toBe(-2.5);
  });

  it('allocates discount and tax proportionally to line contribution', () => {
    const contribution = calculateBillItemNetContribution(
      { subtotal: 100, discountAmount: 10, taxAmount: 5 },
      40,
      15,
    );

    expect(contribution.revenue).toBe(38);
    expect(contribution.profit).toBe(11);
  });

  it('does not allocate discount/tax for zero-subtotal edge cases', () => {
    const contribution = calculateBillItemNetContribution(
      { subtotal: 0, discountAmount: 10, taxAmount: 5 },
      40,
      15,
    );

    expect(contribution.revenue).toBe(40);
    expect(contribution.profit).toBe(15);
  });
});

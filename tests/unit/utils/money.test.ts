import { describe, expect, it } from 'vitest';
import {
  addMoney,
  allocateMoney,
  currencySymbol,
  formatCurrency,
  multiplyMoney,
  normalizeCurrencyCode,
  roundMoney,
  subtractMoney,
  toCents,
} from '@/lib/utils/money';

describe('money utilities', () => {
  it('rounds decimal values through cents to avoid floating point drift', () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(subtractMoney(1, 0.9)).toBe(0.1);
    expect(roundMoney(1.005)).toBe(1.01);
  });

  it('multiplies money by quantities using cent-safe rounding', () => {
    expect(multiplyMoney(2.35, 3)).toBe(7.05);
    expect(multiplyMoney(0.1, 3)).toBe(0.3);
    expect(multiplyMoney(10, Number.NaN)).toBe(0);
  });

  it('allocates proportional shares in cents', () => {
    expect(allocateMoney(10, 0.333)).toBe(3.33);
    expect(allocateMoney(10, Number.NaN)).toBe(0);
  });

  it('normalizes symbols before formatting currency', () => {
    expect(normalizeCurrencyCode('₪')).toBe('ILS');
    expect(currencySymbol('₪')).toBeTruthy();
    expect(formatCurrency(12.345, '₪')).toContain('12.35');
  });

  it('falls back safely for invalid currency codes instead of throwing', () => {
    expect(formatCurrency(5, 'BAD-CODE')).toBe('BAD-CODE 5.00');
    expect(toCents(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

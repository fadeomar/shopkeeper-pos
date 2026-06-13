import { describe, expect, it } from 'vitest';
import {
  baseUnitsPerPricingUnit,
  calculateWeightedLineTotal,
  formatWeight,
  formatWeightForCart,
  gramsToKg,
  kgToGrams,
  parseWeightInput,
} from '@/lib/utils/weight';

describe('weight conversion', () => {
  it('converts kg to integer grams', () => {
    expect(kgToGrams(1)).toBe(1000);
    expect(kgToGrams(0.5)).toBe(500);
    expect(kgToGrams(0.25)).toBe(250);
    expect(kgToGrams(1.5)).toBe(1500);
    expect(kgToGrams(100)).toBe(100000);
    // 2.75 kg must land exactly on 2750 g, not 2749.999…
    expect(kgToGrams(2.75)).toBe(2750);
  });

  it('converts grams to kg', () => {
    expect(gramsToKg(1000)).toBe(1);
    expect(gramsToKg(250)).toBe(0.25);
    expect(gramsToKg(1500)).toBe(1.5);
  });

  it('returns 0 for non-finite conversions instead of NaN', () => {
    expect(kgToGrams(Number.NaN)).toBe(0);
    expect(gramsToKg(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('maps base units to the pricing-unit factor', () => {
    expect(baseUnitsPerPricingUnit('gram')).toBe(1000);
    expect(baseUnitsPerPricingUnit('piece')).toBe(1);
    expect(baseUnitsPerPricingUnit(undefined)).toBe(1);
  });
});

describe('parseWeightInput', () => {
  it('parses kg input into grams by default', () => {
    expect(parseWeightInput('0.25')).toBe(250);
    expect(parseWeightInput('0.5')).toBe(500);
    expect(parseWeightInput('1')).toBe(1000);
    expect(parseWeightInput('1.5')).toBe(1500);
    expect(parseWeightInput('2.75')).toBe(2750);
    expect(parseWeightInput(' 1.5 ')).toBe(1500);
  });

  it('parses gram input when unit is g', () => {
    expect(parseWeightInput('250', 'g')).toBe(250);
    expect(parseWeightInput('500', 'g')).toBe(500);
  });

  it('rejects blank, non-numeric, and negative input', () => {
    expect(parseWeightInput('')).toBeNull();
    expect(parseWeightInput('   ')).toBeNull();
    expect(parseWeightInput('abc')).toBeNull();
    expect(parseWeightInput('-1')).toBeNull();
    expect(parseWeightInput('-0.5')).toBeNull();
  });
});

describe('weight formatting', () => {
  it('formats compactly: grams under 1kg, kg at/above 1kg', () => {
    expect(formatWeight(250)).toBe('250 g');
    expect(formatWeight(500)).toBe('500 g');
    expect(formatWeight(1000)).toBe('1 kg');
    expect(formatWeight(1500)).toBe('1.5 kg');
    expect(formatWeight(62500)).toBe('62.5 kg');
  });

  it('formats cart weights always in kg with trimmed decimals', () => {
    expect(formatWeightForCart(250)).toBe('0.25 kg');
    expect(formatWeightForCart(750)).toBe('0.75 kg');
    expect(formatWeightForCart(1000)).toBe('1 kg');
    expect(formatWeightForCart(1500)).toBe('1.5 kg');
  });

  it('clamps negatives/NaN to a safe 0 display', () => {
    expect(formatWeight(-5)).toBe('0 g');
    expect(formatWeightForCart(Number.NaN)).toBe('0 kg');
  });
});

describe('calculateWeightedLineTotal', () => {
  it('multiplies price-per-kg by kilograms, integer-safe', () => {
    expect(calculateWeightedLineTotal(6, 500)).toBe(3); // 0.5 kg × 6
    expect(calculateWeightedLineTotal(5, 1500)).toBe(7.5); // 1.5 kg × 5
    expect(calculateWeightedLineTotal(8, 250)).toBe(2); // 250 g × 8
    expect(calculateWeightedLineTotal(5, 750)).toBe(3.75); // 0.75 kg × 5
  });

  it('avoids floating-point drift across awkward values', () => {
    // 0.1 + 0.2 style inputs must not corrupt the total.
    expect(calculateWeightedLineTotal(3, 100)).toBe(0.3); // 0.1 kg × 3
    expect(calculateWeightedLineTotal(10, 333)).toBe(3.33); // 0.333 kg × 10
  });
});

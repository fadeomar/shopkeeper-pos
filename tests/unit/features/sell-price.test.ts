import { describe, expect, it } from 'vitest';
import {
  isBelowCost,
  resolveSellPrice,
  sanitizeSellPrice,
  sellPriceFloor,
} from '@/features/bills/utils/sell-price';

describe('sanitizeSellPrice', () => {
  it('keeps a normal non-negative price', () => {
    expect(sanitizeSellPrice(4)).toBe(4);
    expect(sanitizeSellPrice(0)).toBe(0);
  });

  it('floors negatives to 0', () => {
    expect(sanitizeSellPrice(-3)).toBe(0);
  });

  it('treats non-finite input as 0', () => {
    expect(sanitizeSellPrice(Number.NaN)).toBe(0);
    expect(sanitizeSellPrice(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('resolveSellPrice', () => {
  // canSellBelowCost = canEditCost && settings.allowLossSale. Default here is
  // "not allowed" (one or both conditions missing), so the floor applies.
  const ctx = { unitCost: 3, isMisc: false, canSellBelowCost: false };

  it('allows a price at or above cost when below-cost selling is blocked', () => {
    expect(resolveSellPrice({ ...ctx, price: 5 })).toBe(5);
    expect(resolveSellPrice({ ...ctx, price: 3 })).toBe(3);
  });

  it('floors a below-cost price at cost when below-cost selling is blocked', () => {
    expect(resolveSellPrice({ ...ctx, price: 2 })).toBe(3);
    expect(resolveSellPrice({ ...ctx, price: 0 })).toBe(3);
  });

  it('lets the price dip below cost when below-cost selling is permitted', () => {
    expect(resolveSellPrice({ ...ctx, price: 2, canSellBelowCost: true })).toBe(2);
    expect(resolveSellPrice({ ...ctx, price: 0, canSellBelowCost: true })).toBe(0);
  });

  it('never floors a misc line, even when below-cost selling is blocked', () => {
    expect(resolveSellPrice({ ...ctx, price: 1, isMisc: true })).toBe(1);
    expect(resolveSellPrice({ ...ctx, price: 0, isMisc: true })).toBe(0);
  });

  it('sanitizes the typed price before applying the floor', () => {
    expect(resolveSellPrice({ ...ctx, price: -10 })).toBe(3); // negative -> 0 -> floored to cost
    expect(resolveSellPrice({ ...ctx, price: Number.NaN, canSellBelowCost: true })).toBe(0);
  });
});

describe('sellPriceFloor', () => {
  it('floors a real line at cost when below-cost selling is blocked', () => {
    expect(sellPriceFloor(false, false, 3)).toBe(3);
  });

  it('floors permitted, misc, and override cases at 0', () => {
    expect(sellPriceFloor(false, true, 3)).toBe(0); // below-cost permitted
    expect(sellPriceFloor(true, false, 3)).toBe(0); // misc
    expect(sellPriceFloor(true, true, 3)).toBe(0);
  });
});

describe('isBelowCost', () => {
  it('is true for a real line priced under cost', () => {
    expect(isBelowCost(false, 2, 3)).toBe(true);
  });

  it('is false at or above cost', () => {
    expect(isBelowCost(false, 3, 3)).toBe(false);
    expect(isBelowCost(false, 4, 3)).toBe(false);
  });

  it('is never true for a misc line', () => {
    expect(isBelowCost(true, 0, 3)).toBe(false);
  });
});

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
  const ctx = { unitCost: 3, isMisc: false, canEditCost: false };

  it('allows a price at or above cost for a restricted user', () => {
    expect(resolveSellPrice({ ...ctx, price: 5 })).toBe(5);
    expect(resolveSellPrice({ ...ctx, price: 3 })).toBe(3);
  });

  it('floors a below-cost price at cost for a restricted user', () => {
    expect(resolveSellPrice({ ...ctx, price: 2 })).toBe(3);
    expect(resolveSellPrice({ ...ctx, price: 0 })).toBe(3);
  });

  it('lets a privileged user (canEditCost) sell below cost', () => {
    expect(resolveSellPrice({ ...ctx, price: 2, canEditCost: true })).toBe(2);
    expect(resolveSellPrice({ ...ctx, price: 0, canEditCost: true })).toBe(0);
  });

  it('never floors a misc line, even for a restricted user', () => {
    expect(resolveSellPrice({ ...ctx, price: 1, isMisc: true })).toBe(1);
    expect(resolveSellPrice({ ...ctx, price: 0, isMisc: true })).toBe(0);
  });

  it('sanitizes the typed price before applying the floor', () => {
    expect(resolveSellPrice({ ...ctx, price: -10 })).toBe(3); // negative -> 0 -> floored to cost
    expect(resolveSellPrice({ ...ctx, price: Number.NaN, canEditCost: true })).toBe(0);
  });
});

describe('sellPriceFloor', () => {
  it('floors a restricted real line at cost', () => {
    expect(sellPriceFloor(false, false, 3)).toBe(3);
  });

  it('floors privileged, misc, and override cases at 0', () => {
    expect(sellPriceFloor(false, true, 3)).toBe(0); // privileged
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

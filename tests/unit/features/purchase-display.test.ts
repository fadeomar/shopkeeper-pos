import { describe, expect, it } from 'vitest';
import {
  formatPurchaseBaseQuantity,
  formatPurchaseQuantity,
  formatPurchaseStockImpact,
  purchaseUnitCostSuffix,
} from '@/features/purchases/utils/purchase-display';
import type { PurchaseItem } from '@/types/domain';

function makeItem(overrides: Partial<PurchaseItem> = {}): PurchaseItem {
  return {
    id: 'pi_1',
    purchaseId: 'pur_1',
    originalProductId: 'prod_1',
    barcodeAtPurchase: '1000',
    productNameAtPurchase: 'Acamol',
    categoryAtPurchase: 'Pharmacy',
    quantityPurchased: 5,
    unitCostAtPurchase: 2,
    lineSubtotal: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// 10 boxes of Acamol @ 18/box, box = 150 pills -> 1500 pills added.
// The service stores quantityPurchased in BASE units (1500), so the helper
// must derive "10 box" as 1500 / 150 — this mirrors purchase-service.ts.
const multiBox = makeItem({
  saleType: 'multi_unit',
  purchaseUnitNameAtPurchase: 'box',
  conversionToBaseAtPurchase: 150,
  baseQuantityPurchased: 1500,
  quantityPurchased: 1500,
  unitCostAtPurchase: 18,
  lineSubtotal: 180,
});

// 2.5 kg @ 8/kg -> quantityPurchased is grams.
const weight = makeItem({
  saleType: 'weight',
  quantityPurchased: 2500,
  unitCostAtPurchase: 8,
  lineSubtotal: 20,
});

describe('formatPurchaseQuantity', () => {
  it('labels a multi-unit qty with the bought unit', () => {
    expect(formatPurchaseQuantity(multiBox)).toBe('10 box');
  });

  it('shows a weight qty in kg/g', () => {
    expect(formatPurchaseQuantity(weight)).toBe('2.5 kg');
    expect(formatPurchaseQuantity(makeItem({ saleType: 'weight', quantityPurchased: 250 }))).toBe('250 g');
  });

  it('shows a plain count for unit lines', () => {
    expect(formatPurchaseQuantity(makeItem({ quantityPurchased: 5 }))).toBe('5');
  });

  it('falls back to the raw count when the unit name is missing', () => {
    expect(formatPurchaseQuantity(makeItem({ saleType: 'multi_unit', quantityPurchased: 10 }))).toBe('10');
  });
});

describe('formatPurchaseStockImpact', () => {
  it('uses the BASE count + base unit for multi-unit, not the bought-unit count', () => {
    expect(formatPurchaseStockImpact(multiBox, 'pill')).toBe('+1500 pill');
  });

  it('falls back to quantityPurchased (already base) when baseQuantityPurchased is absent', () => {
    const legacy = makeItem({
      saleType: 'multi_unit',
      purchaseUnitNameAtPurchase: 'box',
      conversionToBaseAtPurchase: 150,
      quantityPurchased: 1500, // base count; baseQuantityPurchased not set
    });
    expect(formatPurchaseStockImpact(legacy, 'pill')).toBe('+1500 pill');
    expect(formatPurchaseQuantity(legacy)).toBe('10 box');
  });

  it('shows the grams added for weight lines', () => {
    expect(formatPurchaseStockImpact(weight, 'g')).toBe('+2.5 kg');
  });

  it('shows a plain +count for unit lines', () => {
    expect(formatPurchaseStockImpact(makeItem({ quantityPurchased: 5 }), 'piece')).toBe('+5');
  });

  it('shows an em dash for misc lines (no stock)', () => {
    expect(formatPurchaseStockImpact(makeItem({ itemKind: 'misc' }), 'piece')).toBe('—');
  });
});

describe('formatPurchaseBaseQuantity', () => {
  // Used by the return/remaining displays in purchase-detail: turns an arbitrary
  // BASE count into the bought unit (e.g. a partial return of 5 boxes = 750 pills).
  it('converts a base count into the bought unit for multi-unit', () => {
    expect(formatPurchaseBaseQuantity(multiBox, 750)).toBe('5 box');
  });

  it('shows a base gram count as kg/g for weight', () => {
    expect(formatPurchaseBaseQuantity(weight, 500)).toBe('500 g');
    expect(formatPurchaseBaseQuantity(weight, 1500)).toBe('1.5 kg');
  });

  it('shows a plain base count for unit lines', () => {
    expect(formatPurchaseBaseQuantity(makeItem(), 3)).toBe('3');
  });

  it('falls back to the raw count when the unit name is missing', () => {
    expect(
      formatPurchaseBaseQuantity(
        makeItem({ saleType: 'multi_unit', conversionToBaseAtPurchase: 150 }),
        300,
      ),
    ).toBe('2');
  });
});

describe('purchaseUnitCostSuffix', () => {
  it('appends the bought unit for multi-unit', () => {
    expect(purchaseUnitCostSuffix(multiBox, '/ kg')).toBe(' / box');
  });

  it('appends the per-kg suffix for weight', () => {
    expect(purchaseUnitCostSuffix(weight, '/ kg')).toBe(' / kg');
  });

  it('is empty for unit lines', () => {
    expect(purchaseUnitCostSuffix(makeItem(), '/ kg')).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import {
  LEGACY_UNIT_ID,
  buildLegacyUnit,
  formatStockBreakdown,
  getStockBreakdownParts,
  getDefaultProductUnit,
  getDefaultPurchaseUnit,
  getProductSaleType,
  getPurchasableUnits,
  getSellableUnits,
  isMultiUnitProduct,
  toBaseQuantity,
  validateUnitDrafts,
} from '@/lib/utils/multi-unit';
import type { Product, ProductUnit } from '@/types/domain';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod_acamol',
    barcode: '1000',
    name: 'Acamol',
    category: 'Pharmacy',
    unit: 'pill',
    saleType: 'multi_unit',
    defaultSaleUnitId: 'u_strip',
    quantityInStock: 1477,
    buyPrice: 0.1,
    sellPrice: 0.2,
    minimumStockAlert: 100,
    dateAdded: '2026-01-01',
    lastUpdated: '2026-01-01',
    status: 'active',
    ...overrides,
  };
}

function unit(overrides: Partial<ProductUnit>): ProductUnit {
  return {
    id: 'u',
    productId: 'prod_acamol',
    name: 'unit',
    conversionToBase: 1,
    sellPrice: 1,
    canSell: true,
    canPurchase: true,
    sortOrder: 0,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

const PHARMACY_UNITS: ProductUnit[] = [
  unit({ id: 'u_pill', name: 'pill', conversionToBase: 1, sellPrice: 0.2, canSell: true, canPurchase: false, sortOrder: 0 }),
  unit({ id: 'u_strip', name: 'strip', conversionToBase: 10, sellPrice: 2, canSell: true, canPurchase: true, isDefaultSaleUnit: true, sortOrder: 1 }),
  unit({ id: 'u_box', name: 'box', conversionToBase: 150, sellPrice: 28, canSell: true, canPurchase: true, sortOrder: 2 }),
];

describe('unit conversion (toBaseQuantity)', () => {
  it('converts whole units to base counts', () => {
    expect(toBaseQuantity(1, { conversionToBase: 150 })).toBe(150); // 1 box
    expect(toBaseQuantity(2, { conversionToBase: 10 })).toBe(20); // 2 strips
    expect(toBaseQuantity(3, { conversionToBase: 1 })).toBe(3); // 3 pills
    expect(toBaseQuantity(10, { conversionToBase: 150 })).toBe(1500); // 10 boxes
  });
});

describe('mixed-stock formatting', () => {
  it('decomposes 1477 pills into 9 box + 12 strip + 7 pill', () => {
    const product = makeProduct();
    const parts = getStockBreakdownParts(product, PHARMACY_UNITS, 1477);
    expect(parts).toEqual([
      { unitId: 'u_box', unitName: 'box', count: 9 },
      { unitId: 'u_strip', unitName: 'strip', count: 12 },
      { unitId: 'u_pill', unitName: 'pill', count: 7 },
    ]);
    expect(formatStockBreakdown(product, PHARMACY_UNITS, 1477)).toBe('9 box + 12 strip + 7 pill');
  });

  it('shows a single zero base-unit part for empty stock', () => {
    const product = makeProduct({ quantityInStock: 0 });
    expect(formatStockBreakdown(product, PHARMACY_UNITS, 0)).toBe('0 pill');
  });

  it('drops units with a zero count', () => {
    const product = makeProduct();
    // exactly 2 boxes
    expect(formatStockBreakdown(product, PHARMACY_UNITS, 300)).toBe('2 box');
  });
});

describe('sellable / purchasable units', () => {
  it('filters by canSell / canPurchase', () => {
    const product = makeProduct();
    expect(getSellableUnits(product, PHARMACY_UNITS).map((u) => u.id)).toEqual([
      'u_pill',
      'u_strip',
      'u_box',
    ]);
    // pill is canPurchase:false → excluded
    expect(getPurchasableUnits(product, PHARMACY_UNITS).map((u) => u.id)).toEqual([
      'u_strip',
      'u_box',
    ]);
  });

  it('picks the default sale unit by id, then by flag', () => {
    const product = makeProduct({ defaultSaleUnitId: 'u_box' });
    expect(getDefaultProductUnit(product, PHARMACY_UNITS).id).toBe('u_box');
    const noExplicit = makeProduct({ defaultSaleUnitId: undefined });
    expect(getDefaultProductUnit(noExplicit, PHARMACY_UNITS).id).toBe('u_strip');
  });

  it('default purchase unit prefers a purchasable default sale unit', () => {
    const product = makeProduct();
    // default sale unit is strip (purchasable) → used for purchase too
    expect(getDefaultPurchaseUnit(product, PHARMACY_UNITS).id).toBe('u_strip');
  });
});

describe('legacy (unit / weight) products', () => {
  it('treats an absent saleType as unit', () => {
    const legacy = makeProduct({ saleType: undefined, defaultSaleUnitId: undefined, unit: 'pcs' });
    expect(getProductSaleType(legacy)).toBe('unit');
    expect(isMultiUnitProduct(legacy)).toBe(false);
  });

  it('synthesizes a virtual base unit for non-multi_unit products', () => {
    const legacy = makeProduct({ saleType: undefined, defaultSaleUnitId: undefined, unit: 'pcs' });
    const virtual = buildLegacyUnit(legacy);
    expect(virtual.id).toBe(LEGACY_UNIT_ID);
    expect(virtual.conversionToBase).toBe(1);
    expect(virtual.canSell).toBe(true);

    // The default unit for a legacy product is the virtual one (conversion 1).
    const def = getDefaultProductUnit(legacy, undefined);
    expect(def.conversionToBase).toBe(1);
    // toBaseQuantity through the virtual unit is a no-op.
    expect(toBaseQuantity(5, def)).toBe(5);
  });
});

describe('unit validation', () => {
  it('accepts a well-formed multi-unit set', () => {
    expect(validateUnitDrafts(PHARMACY_UNITS)).toEqual([]);
  });

  it('requires at least one sellable unit', () => {
    const units = PHARMACY_UNITS.map((u) => ({ ...u, canSell: false }));
    expect(validateUnitDrafts(units).some((i) => i.code === 'no_sellable')).toBe(true);
  });

  it('requires exactly one default sale unit', () => {
    const none = PHARMACY_UNITS.map((u) => ({ ...u, isDefaultSaleUnit: false }));
    expect(validateUnitDrafts(none).some((i) => i.code === 'no_default')).toBe(true);
    const two = PHARMACY_UNITS.map((u) => ({ ...u, isDefaultSaleUnit: true }));
    expect(validateUnitDrafts(two).some((i) => i.code === 'multiple_default')).toBe(true);
  });

  it('requires a base unit with conversionToBase = 1', () => {
    const noBase = [
      unit({ id: 'a', name: 'strip', conversionToBase: 10, isDefaultSaleUnit: true }),
      unit({ id: 'b', name: 'box', conversionToBase: 150 }),
    ];
    expect(validateUnitDrafts(noBase).some((i) => i.code === 'no_base')).toBe(true);
  });

  it('rejects non-positive-integer conversions and empty names', () => {
    const bad = [
      unit({ id: 'a', name: '', conversionToBase: 1, isDefaultSaleUnit: true }),
      unit({ id: 'b', name: 'half', conversionToBase: 1.5 }),
    ];
    const codes = validateUnitDrafts(bad).map((i) => i.code);
    expect(codes).toContain('empty_name');
    expect(codes).toContain('bad_conversion');
  });

  it('rejects duplicate barcodes within the set', () => {
    const dup = [
      unit({ id: 'a', name: 'pill', conversionToBase: 1, barcode: 'X', isDefaultSaleUnit: true }),
      unit({ id: 'b', name: 'strip', conversionToBase: 10, barcode: 'X' }),
    ];
    expect(validateUnitDrafts(dup).some((i) => i.code === 'duplicate_barcode')).toBe(true);
  });
});

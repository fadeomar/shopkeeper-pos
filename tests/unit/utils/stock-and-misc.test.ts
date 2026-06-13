import { describe, expect, it } from 'vitest';
import { makeProduct, makeSettings } from '@/tests/helpers/builders';
import { isMiscLine, MISC_ITEM_BARCODE, MISC_ITEM_CATEGORY, MISC_ITEM_ID_PREFIX } from '@/lib/utils/misc-items';
import { isLowStock, lowStockLimit } from '@/lib/utils/stock';

describe('stock alert helpers', () => {
  it('uses product minimum stock alert when explicitly set', () => {
    const product = makeProduct({ minimumStockAlert: 7, quantityInStock: 7 });
    expect(lowStockLimit(product, makeSettings({ lowStockThreshold: 3 }))).toBe(7);
    expect(isLowStock(product, makeSettings({ lowStockThreshold: 3 }))).toBe(true);
  });

  it('falls back to store-wide low stock threshold when product alert is zero', () => {
    const product = makeProduct({ minimumStockAlert: 0, quantityInStock: 4 });
    expect(lowStockLimit(product, makeSettings({ lowStockThreshold: 5 }))).toBe(5);
    expect(isLowStock(product, makeSettings({ lowStockThreshold: 5 }))).toBe(true);
  });

  it('does not mark stock as low above the effective threshold', () => {
    const product = makeProduct({ minimumStockAlert: 2, quantityInStock: 3 });
    expect(isLowStock(product, makeSettings({ lowStockThreshold: 10 }))).toBe(false);
  });
});

describe('misc item helpers', () => {
  it('identifies ad-hoc misc lines by explicit kind or generated id prefix', () => {
    expect(isMiscLine({ itemKind: 'misc', productId: 'anything' })).toBe(true);
    expect(isMiscLine({ productId: `${MISC_ITEM_ID_PREFIX}_1700000000000` })).toBe(true);
    expect(isMiscLine({ originalProductId: `${MISC_ITEM_ID_PREFIX}_old` })).toBe(true);
  });

  it('does not treat normal product lines as misc', () => {
    expect(isMiscLine({ productId: 'product-1', itemKind: 'product' })).toBe(false);
    expect(MISC_ITEM_BARCODE).toBe('MISC');
    expect(MISC_ITEM_CATEGORY).toBe('Misc');
  });
});

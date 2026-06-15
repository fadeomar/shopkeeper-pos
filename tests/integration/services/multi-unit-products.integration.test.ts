import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/schema';
import {
  makeBillDraftItem,
  makeBillForm,
  makeProduct,
  makePurchaseDraftItem,
  makePurchaseForm,
} from '@/tests/helpers/builders';
import { resetTestDb, seedProduct, seedSettings } from '@/tests/helpers/db';
import { AppErrorCode } from '@/lib/errors/app-error';
import type { Product, ProductUnit } from '@/types/domain';

vi.mock('@/lib/services/subscription-service', () => ({
  assertSubscriptionCanWrite: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/permission-service', () => ({
  assertPermission: vi.fn().mockResolvedValue(undefined),
  getCurrentPermissions: vi.fn().mockResolvedValue({
    canVoid: true,
    canReturn: true,
    canDiscount: true,
    canViewProfit: true,
    canEditCost: true,
    canExport: true,
    canManageSettings: true,
    canManageRolePermissions: true,
  }),
}));

vi.mock('@/lib/services/audit-service', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

const { createFinalizedBill } = await import('@/lib/services/billing-service');
const { createFinalizedPurchase } = await import('@/lib/services/purchase-service');
const { buildProductUnit, saveProductUnits } = await import('@/lib/services/product-unit-service');

/**
 * Acamol — a multi_unit product. Base unit is the pill; quantityInStock and the
 * lots are counted in base pills.
 */

function baseUnit(product: Product, overrides: Partial<ProductUnit> = {}): ProductUnit {
  return buildProductUnit(
    product.id,
    {
      id: overrides.id,
      name: overrides.name ?? 'pill',
      conversionToBase: overrides.conversionToBase ?? 1,
      sellPrice: overrides.sellPrice ?? 0.25,
      buyPrice: overrides.buyPrice ?? 0.1,
      barcode: overrides.barcode,
      canSell: overrides.canSell ?? true,
      canPurchase: overrides.canPurchase ?? true,
      isDefaultSaleUnit: overrides.isDefaultSaleUnit ?? true,
    },
    overrides.sortOrder ?? 0,
    '2026-01-01T00:00:00.000Z',
  );
}

function makeAcamol(overrides: Partial<Product> = {}): Product {
  return makeProduct({
    id: 'acamol',
    name: 'Acamol',
    barcode: '1000',
    unit: 'pill',
    saleType: 'multi_unit',
    defaultSaleUnitId: 'u_strip',
    quantityInStock: 0,
    buyPrice: 0.1,
    sellPrice: 0.2,
    ...overrides,
  });
}

describe('multi-unit products', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestDb();
    await seedSettings({ allowLossSale: true });
  });

  it('buying 10 boxes adds 1500 base pieces and a per-pill cost lot', async () => {
    const product = await seedProduct(makeAcamol());

    await createFinalizedPurchase({
      items: [
        makePurchaseDraftItem(product, {
          saleType: 'multi_unit',
          purchaseUnitId: 'u_box',
          purchaseUnitName: 'box',
          conversionToBase: 150,
          quantity: 10, // 10 boxes
          baseQuantity: 1500, // = 10 × 150 pills
          unitCost: 18, // per box
        }),
      ],
      form: makePurchaseForm({ paidAmount: 180 }),
    });

    // Stock grows in base pieces; buyPrice becomes the per-base (per-pill) cost.
    await expect(db.products.get('acamol')).resolves.toMatchObject({
      quantityInStock: 1500,
      buyPrice: 0.12, // 18 / 150
    });

    const lots = await db.inventoryLots.where('productId').equals('acamol').toArray();
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({
      baseUnit: 'piece',
      quantityReceived: 1500,
      quantityRemaining: 1500,
      unitCost: 0.12, // per pill
    });

    const items = await db.purchaseItems.toArray();
    expect(items[0]).toMatchObject({
      saleType: 'multi_unit',
      purchaseUnitNameAtPurchase: 'box',
      conversionToBaseAtPurchase: 150,
      quantityPurchased: 1500, // base pieces
      baseQuantityPurchased: 1500,
      unitCostAtPurchase: 18, // per box (for the receipt)
      lineSubtotal: 180, // 10 boxes × 18
    });
  });

  it('selling 2 strips subtracts 20 base pieces and snapshots the unit', async () => {
    // buyPrice 0.12/pill → seedProduct seeds an opening lot at that cost.
    const product = await seedProduct(makeAcamol({ quantityInStock: 1500, buyPrice: 0.12 }));

    const { billItems } = await createFinalizedBill({
      items: [
        makeBillDraftItem(product, {
          saleType: 'multi_unit',
          saleUnitId: 'u_strip',
          saleUnitName: 'strip',
          conversionToBase: 10,
          quantity: 2, // 2 strips
          baseQuantity: 20, // = 2 × 10 pills
          availableStock: 1500,
          unitSellPrice: 2, // per strip
          unitBuyPrice: 1.2,
        }),
      ],
      form: makeBillForm({ paymentMethod: 'cash', paidAmount: 4 }),
    });

    await expect(db.products.get('acamol')).resolves.toMatchObject({
      quantityInStock: 1480, // 1500 − 20
    });

    expect(billItems[0]).toMatchObject({
      saleType: 'multi_unit',
      saleUnitNameAtSale: 'strip',
      conversionToBaseAtSale: 10,
      quantitySold: 2, // sold-unit count
      baseQuantitySold: 20, // base pieces
      lineSubtotal: 4, // 2 strips × 2
    });
    // FIFO cost: 20 pills × 0.12 = 2.40 → profit 4 − 2.40 = 1.60
    expect(billItems[0].lineProfit).toBeCloseTo(1.6, 5);
  });

  it('can sell the same product as a box and a strip in one bill', async () => {
    const product = await seedProduct(makeAcamol({ quantityInStock: 1500 }));

    const bill = await createFinalizedBill({
      items: [
        makeBillDraftItem(product, {
          saleType: 'multi_unit',
          saleUnitId: 'u_box',
          saleUnitName: 'box',
          conversionToBase: 150,
          quantity: 1,
          baseQuantity: 150,
          availableStock: 1500,
          unitSellPrice: 28,
        }),
        makeBillDraftItem(product, {
          saleType: 'multi_unit',
          saleUnitId: 'u_strip',
          saleUnitName: 'strip',
          conversionToBase: 10,
          quantity: 2,
          baseQuantity: 20,
          availableStock: 1500,
          unitSellPrice: 2,
        }),
      ],
      form: makeBillForm({ paymentMethod: 'cash', paidAmount: 32 }),
    });

    // Two distinct bill items, base stock down by 150 + 20 = 170.
    expect(bill.billItems).toHaveLength(2);
    await expect(db.products.get('acamol')).resolves.toMatchObject({
      quantityInStock: 1330,
    });
  });

  it('blocks a multi-unit sale that exceeds base stock', async () => {
    const product = await seedProduct(makeAcamol({ quantityInStock: 20 }));

    await expect(
      createFinalizedBill({
        items: [
          makeBillDraftItem(product, {
            saleType: 'multi_unit',
            saleUnitId: 'u_strip',
            saleUnitName: 'strip',
            conversionToBase: 10,
            quantity: 3, // 30 base pieces > 20 in stock
            baseQuantity: 30,
            availableStock: 20,
            unitSellPrice: 2,
          }),
        ],
        form: makeBillForm({ paymentMethod: 'cash', paidAmount: 6 }),
      }),
    ).rejects.toThrow();

    // 2 strips (20 pieces) is exactly the stock and succeeds.
    const ok = await createFinalizedBill({
      items: [
        makeBillDraftItem(product, {
          saleType: 'multi_unit',
          saleUnitId: 'u_strip',
          saleUnitName: 'strip',
          conversionToBase: 10,
          quantity: 2,
          baseQuantity: 20,
          availableStock: 20,
          unitSellPrice: 2,
        }),
      ],
      form: makeBillForm({ paymentMethod: 'cash', paidAmount: 4 }),
    });
    expect(ok.billItems).toHaveLength(1);
    await expect(db.products.get('acamol')).resolves.toMatchObject({ quantityInStock: 0 });
  });

  it('blocks duplicate barcodes across product units and product barcodes', async () => {
    const acamol = await seedProduct(makeAcamol({ id: 'acamol_a', barcode: 'PROD-A' }));
    const panadol = await seedProduct(
      makeAcamol({ id: 'panadol_b', name: 'Panadol', barcode: 'PROD-B' }),
    );

    await saveProductUnits({
      product: { id: acamol.id, name: acamol.name },
      units: [baseUnit(acamol, { id: 'unit_acamol_pill', barcode: 'UNIT-123' })],
    });

    await expect(
      saveProductUnits({
        product: { id: panadol.id, name: panadol.name },
        units: [baseUnit(panadol, { id: 'unit_panadol_pill', barcode: 'UNIT-123' })],
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.PRODUCT_UNIT_BARCODE_DUPLICATE });

    await expect(
      saveProductUnits({
        product: { id: panadol.id, name: panadol.name },
        units: [baseUnit(panadol, { id: 'unit_panadol_box', barcode: 'PROD-A' })],
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.PRODUCT_UNIT_BARCODE_DUPLICATE });
  });

});

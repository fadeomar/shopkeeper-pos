import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/schema';
import { makeBillDraftItem, makeBillForm, makeProduct } from '@/tests/helpers/builders';
import { resetTestDb, seedProduct, seedSettings } from '@/tests/helpers/db';
import { AppErrorCode } from '@/lib/errors/app-error';
import type { Product, ProductUnit } from '@/types/domain';

vi.mock('@/lib/services/subscription-service', () => ({
  assertSubscriptionCanWrite: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/permission-service', () => ({
  assertPermission: vi.fn().mockResolvedValue(undefined),
  assertAppPermission: vi.fn().mockResolvedValue(undefined),
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
const { getCurrentPermissions } = await import('@/lib/services/permission-service');
const { createProductWithInitialMovement } = await import('@/lib/services/inventory-service');
const { buildProductUnit, saveMultiUnitProductWithUnits, saveProductUnits } = await import(
  '@/lib/services/product-unit-service'
);

/** Make the next getCurrentPermissions() call report no canEditCost. */
function denyCostEditOnce(): void {
  vi.mocked(getCurrentPermissions).mockResolvedValueOnce({
    canVoid: true,
    canReturn: true,
    canDiscount: true,
    canViewProfit: true,
    canEditCost: false,
    canExport: true,
    canManageSettings: true,
    canManageRolePermissions: true,
  });
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

/** A valid pharmacy unit set: pill (base) / strip (default) / box. */
function pharmacyUnits(productId: string): ProductUnit[] {
  return [
    buildProductUnit(productId, { id: 'u_pill', name: 'pill', conversionToBase: 1, sellPrice: 0.25, buyPrice: 0.1, canSell: true, canPurchase: false, isDefaultSaleUnit: false }, 0, '2026-01-01T00:00:00.000Z'),
    buildProductUnit(productId, { id: 'u_strip', name: 'strip', conversionToBase: 10, sellPrice: 2, buyPrice: 1, canSell: true, canPurchase: true, isDefaultSaleUnit: true }, 1, '2026-01-01T00:00:00.000Z'),
    buildProductUnit(productId, { id: 'u_box', name: 'box', conversionToBase: 150, sellPrice: 28, buyPrice: 15, canSell: true, canPurchase: true, isDefaultSaleUnit: false }, 2, '2026-01-01T00:00:00.000Z'),
  ];
}

describe('saveMultiUnitProductWithUnits (atomic create/update)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestDb();
    await seedSettings({ allowLossSale: true });
  });

  it('create: writes the product, opening lot/movement, and all units in one go', async () => {
    const product = makeAcamol({ quantityInStock: 300, buyPrice: 0.1 });

    await saveMultiUnitProductWithUnits({
      mode: 'create',
      product,
      units: pharmacyUnits(product.id),
    });

    await expect(db.products.get('acamol')).resolves.toMatchObject({
      saleType: 'multi_unit',
      quantityInStock: 300,
      buyPrice: 0.1,
    });
    const units = await db.productUnits.where('productId').equals('acamol').toArray();
    expect(units).toHaveLength(3);

    const lots = await db.inventoryLots.where('productId').equals('acamol').toArray();
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ baseUnit: 'piece', quantityReceived: 300, unitCost: 0.1 });

    const movements = await db.stockMovements.where('productId').equals('acamol').toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ movementType: 'initial', quantityChange: 300 });

    // product + movement + lot + 3 units = 6 sync jobs.
    expect(await db.syncQueue.count()).toBe(6);
  });

  it('create: invalid units abort the whole write — no product, lot, or units persist', async () => {
    const product = makeAcamol({ quantityInStock: 300 });
    // No base unit (no conversion === 1) → validateUnitDrafts fails.
    const invalid = pharmacyUnits(product.id).filter((u) => u.conversionToBase !== 1);

    await expect(
      saveMultiUnitProductWithUnits({ mode: 'create', product, units: invalid }),
    ).rejects.toMatchObject({ code: AppErrorCode.PRODUCT_UNIT_INVALID });

    expect(await db.products.get('acamol')).toBeUndefined();
    expect(await db.productUnits.where('productId').equals('acamol').count()).toBe(0);
    expect(await db.inventoryLots.where('productId').equals('acamol').count()).toBe(0);
  });

  it('create without canEditCost: unit buy prices are dropped (cost backstop)', async () => {
    denyCostEditOnce();
    const product = makeAcamol({ quantityInStock: 0, buyPrice: 0.1 });

    await saveMultiUnitProductWithUnits({
      mode: 'create',
      product,
      units: pharmacyUnits(product.id), // these carry buyPrices
    });

    const units = await db.productUnits.where('productId').equals('acamol').toArray();
    expect(units).toHaveLength(3);
    expect(units.every((u) => u.buyPrice === undefined)).toBe(true);
  });

  it('update without canEditCost: a unit buy-price change is ignored, keeping the stored cost', async () => {
    // Seed units WITH costs (canEditCost true by default).
    const product = await seedProduct(makeAcamol({ quantityInStock: 0, buyPrice: 0.1 }));
    await saveMultiUnitProductWithUnits({ mode: 'create', product, units: pharmacyUnits(product.id) });
    const before = await db.productUnits.get('u_box');
    expect(before?.buyPrice).toBe(15);

    // Now a no-cost user tries to bump the box cost to 999.
    denyCostEditOnce();
    const tampered = pharmacyUnits(product.id).map((u) =>
      u.id === 'u_box' ? { ...u, buyPrice: 999 } : u,
    );
    await saveMultiUnitProductWithUnits({
      mode: 'update',
      product,
      changes: { name: 'Acamol' },
      units: tampered,
    });

    const after = await db.productUnits.get('u_box');
    expect(after?.buyPrice).toBe(15); // stored cost preserved, not 999
  });

  it('blocks creating a product whose barcode equals another product\'s unit barcode', async () => {
    // Acamol owns a box unit with barcode UNIT-BC.
    const acamol = await seedProduct(makeAcamol({ id: 'acamol', barcode: 'ACA-1' }));
    await saveMultiUnitProductWithUnits({
      mode: 'create',
      product: acamol,
      units: [
        buildProductUnit(acamol.id, { id: 'u_pill', name: 'pill', conversionToBase: 1, sellPrice: 0.25, buyPrice: 0.1, canSell: true, canPurchase: false, isDefaultSaleUnit: true }, 0, '2026-01-01T00:00:00.000Z'),
        buildProductUnit(acamol.id, { id: 'u_box', name: 'box', conversionToBase: 150, sellPrice: 28, buyPrice: 15, canSell: true, canPurchase: true, barcode: 'UNIT-BC' }, 1, '2026-01-01T00:00:00.000Z'),
      ],
    });

    // A brand-new product can't claim UNIT-BC as its own barcode.
    const clashing = makeProduct({ id: 'panadol', name: 'Panadol', saleType: 'unit', barcode: 'UNIT-BC', quantityInStock: 5 });
    await expect(createProductWithInitialMovement(clashing)).rejects.toMatchObject({
      code: AppErrorCode.PRODUCT_UNIT_BARCODE_DUPLICATE,
    });
    expect(await db.products.get('panadol')).toBeUndefined();
  });

  it('create: blocks a product whose own barcode equals one of its incoming unit barcodes', async () => {
    // The new product isn't in the DB yet, so assertUniqueProductUnitBarcodes
    // (which compares units against STORED product barcodes) can't catch this —
    // the input set must be checked directly. Product barcode wins the scanner,
    // so an overlap would silently shadow the unit.
    const product = makeAcamol({ id: 'acamol', barcode: 'SHARED-BC', quantityInStock: 300 });
    const units = [
      buildProductUnit(product.id, { id: 'u_pill', name: 'pill', conversionToBase: 1, sellPrice: 0.25, buyPrice: 0.1, canSell: true, canPurchase: false, isDefaultSaleUnit: true }, 0, '2026-01-01T00:00:00.000Z'),
      buildProductUnit(product.id, { id: 'u_box', name: 'box', conversionToBase: 150, sellPrice: 28, buyPrice: 15, canSell: true, canPurchase: true, barcode: 'SHARED-BC' }, 1, '2026-01-01T00:00:00.000Z'),
    ];

    await expect(
      saveMultiUnitProductWithUnits({ mode: 'create', product, units }),
    ).rejects.toMatchObject({ code: AppErrorCode.PRODUCT_UNIT_BARCODE_DUPLICATE });

    // Pre-transaction guard: nothing was written.
    expect(await db.products.get('acamol')).toBeUndefined();
    expect(await db.productUnits.where('productId').equals('acamol').count()).toBe(0);
    expect(await db.inventoryLots.where('productId').equals('acamol').count()).toBe(0);
  });

  it('update: a conversion-lock failure rolls back the product change too', async () => {
    // Seed a product + units, then create history by selling a strip so the
    // strip unit can no longer change conversion.
    const product = await seedProduct(makeAcamol({ quantityInStock: 1500, buyPrice: 0.12 }));
    await saveProductUnits({ product: { id: product.id, name: product.name }, units: pharmacyUnits(product.id) });

    await createFinalizedBill({
      items: [
        makeBillDraftItem(product, {
          saleType: 'multi_unit',
          saleUnitId: 'u_strip',
          saleUnitName: 'strip',
          conversionToBase: 10,
          quantity: 1,
          baseQuantity: 10,
          availableStock: 1500,
          unitSellPrice: 2,
        }),
      ],
      form: makeBillForm({ paymentMethod: 'cash', paidAmount: 2 }),
    });

    // Now attempt an update that BOTH renames the product AND illegally changes
    // the used strip's conversion. The unit step must throw, and the rename
    // must roll back with it.
    const tampered = pharmacyUnits(product.id).map((u) =>
      u.id === 'u_strip' ? { ...u, conversionToBase: 20 } : u,
    );

    await expect(
      saveMultiUnitProductWithUnits({
        mode: 'update',
        product,
        changes: { name: 'Acamol RENAMED', sellPrice: 999 },
        units: tampered,
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.PRODUCT_UNIT_CONVERSION_LOCKED });

    // Rollback: product unchanged, strip conversion still 10.
    await expect(db.products.get('acamol')).resolves.toMatchObject({
      name: 'Acamol',
      sellPrice: 0.2,
    });
    const strip = await db.productUnits.get('u_strip');
    expect(strip?.conversionToBase).toBe(10);
  });
});

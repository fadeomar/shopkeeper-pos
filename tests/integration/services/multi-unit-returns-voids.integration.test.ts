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

const { createFinalizedBill, returnBillItem, voidBill } = await import('@/lib/services/billing-service');
const { createFinalizedPurchase, returnPurchaseItem, voidPurchase } = await import('@/lib/services/purchase-service');
const { buildProductUnit, saveProductUnits } = await import('@/lib/services/product-unit-service');

function makeAcamol(overrides: Partial<Product> = {}): Product {
  return makeProduct({
    id: 'acamol',
    name: 'Acamol',
    barcode: '1000',
    unit: 'pill',
    saleType: 'multi_unit',
    defaultSaleUnitId: 'u_strip',
    quantityInStock: 0,
    buyPrice: 0.12,
    sellPrice: 0.2,
    ...overrides,
  });
}

function pharmacyUnits(productId: string): ProductUnit[] {
  return [
    buildProductUnit(productId, { id: 'u_pill', name: 'pill', conversionToBase: 1, sellPrice: 0.25, buyPrice: 0.12, canSell: true, canPurchase: false, isDefaultSaleUnit: false }, 0, '2026-01-01T00:00:00.000Z'),
    buildProductUnit(productId, { id: 'u_strip', name: 'strip', conversionToBase: 10, sellPrice: 2, buyPrice: 1.2, canSell: true, canPurchase: true, isDefaultSaleUnit: true }, 1, '2026-01-01T00:00:00.000Z'),
    buildProductUnit(productId, { id: 'u_box', name: 'box', conversionToBase: 150, sellPrice: 28, buyPrice: 18, canSell: true, canPurchase: true, isDefaultSaleUnit: false }, 2, '2026-01-01T00:00:00.000Z'),
  ];
}

/** Sell `strips` strips of Acamol; returns the finalized bill + its items. */
async function sellStrips(product: Product, strips: number) {
  return createFinalizedBill({
    items: [
      makeBillDraftItem(product, {
        saleType: 'multi_unit',
        saleUnitId: 'u_strip',
        saleUnitName: 'strip',
        conversionToBase: 10,
        quantity: strips,
        baseQuantity: strips * 10,
        availableStock: product.quantityInStock,
        unitSellPrice: 2,
        unitBuyPrice: 1.2,
      }),
    ],
    form: makeBillForm({ paymentMethod: 'cash', paidAmount: strips * 2 }),
  });
}

describe('multi-unit returns', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestDb();
    await seedSettings({ allowLossSale: true });
  });

  it('returns 1 strip out of 2 — restores 10 base pieces, marks the bill partially returned', async () => {
    const product = await seedProduct(makeAcamol({ quantityInStock: 1500 }));
    await saveProductUnits({ product: { id: product.id, name: product.name }, units: pharmacyUnits(product.id) });

    const { bill, billItems } = await sellStrips(product, 2); // 20 base out → 1480
    await expect(db.products.get('acamol')).resolves.toMatchObject({ quantityInStock: 1480 });

    await returnBillItem({ billId: bill.id, itemId: billItems[0].id, quantity: 10, reason: 'damaged' });

    await expect(db.products.get('acamol')).resolves.toMatchObject({ quantityInStock: 1490 });
    const item = await db.billItems.get(billItems[0].id);
    expect(item).toMatchObject({ quantityReturned: 1, baseQuantityReturned: 10 });
    await expect(db.bills.get(bill.id)).resolves.toMatchObject({ status: 'partially_returned' });
  });

  it('returns the full multi-unit bill — restores all base stock and marks it returned', async () => {
    const product = await seedProduct(makeAcamol({ quantityInStock: 1500 }));
    await saveProductUnits({ product: { id: product.id, name: product.name }, units: pharmacyUnits(product.id) });

    const { bill, billItems } = await sellStrips(product, 2);
    await returnBillItem({ billId: bill.id, itemId: billItems[0].id, quantity: 20, reason: 'wrong item' });

    await expect(db.products.get('acamol')).resolves.toMatchObject({ quantityInStock: 1500 });
    await expect(db.bills.get(bill.id)).resolves.toMatchObject({ status: 'returned' });
  });
});

describe('multi-unit voids', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestDb();
    await seedSettings({ allowLossSale: true });
  });

  it('voids a bill with no prior return — fully restores base stock', async () => {
    const product = await seedProduct(makeAcamol({ quantityInStock: 1500 }));
    await saveProductUnits({ product: { id: product.id, name: product.name }, units: pharmacyUnits(product.id) });

    const { bill } = await sellStrips(product, 2);
    await voidBill({ billId: bill.id, reason: 'mistake' });

    await expect(db.products.get('acamol')).resolves.toMatchObject({ quantityInStock: 1500 });
    await expect(db.bills.get(bill.id)).resolves.toMatchObject({ status: 'voided' });
  });

  it('blocks voiding a bill that was partially returned (must be finalized)', async () => {
    // Contract guard: returnBillItem moves the bill to "partially_returned", and
    // voidBill only acts on "finalized" bills. Voiding a partially-returned bill
    // would double-count the already-restored stock, so it is rejected.
    const product = await seedProduct(makeAcamol({ quantityInStock: 1500 }));
    await saveProductUnits({ product: { id: product.id, name: product.name }, units: pharmacyUnits(product.id) });

    const { bill, billItems } = await sellStrips(product, 2);
    await returnBillItem({ billId: bill.id, itemId: billItems[0].id, quantity: 10, reason: 'damaged' });

    await expect(voidBill({ billId: bill.id, reason: 'changed mind' })).rejects.toMatchObject({
      code: AppErrorCode.BILL_NOT_FINALIZED,
    });
    // Stock unchanged by the rejected void (still the 1490 from the partial return).
    await expect(db.products.get('acamol')).resolves.toMatchObject({ quantityInStock: 1490 });
  });
});

describe('multi-unit purchase return / void after a partial sale', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestDb();
    await seedSettings({ allowLossSale: true });
  });

  async function buyOneBoxThenSellPills(pillsSold: number) {
    const product = await seedProduct(makeAcamol({ quantityInStock: 0 }));
    await saveProductUnits({ product: { id: product.id, name: product.name }, units: pharmacyUnits(product.id) });

    const { purchase, purchaseItems } = await createFinalizedPurchase({
      items: [
        makePurchaseDraftItem(product, {
          saleType: 'multi_unit',
          purchaseUnitId: 'u_box',
          purchaseUnitName: 'box',
          conversionToBase: 150,
          quantity: 1, // 1 box
          baseQuantity: 150, // 150 pills
          unitCost: 18,
        }),
      ],
      form: makePurchaseForm({ paidAmount: 18 }),
    });
    // Stock is now 150 pills.
    const live = (await db.products.get('acamol'))!;
    if (pillsSold > 0) {
      await createFinalizedBill({
        items: [
          makeBillDraftItem(live, {
            saleType: 'multi_unit',
            saleUnitId: 'u_pill',
            saleUnitName: 'pill',
            conversionToBase: 1,
            quantity: pillsSold,
            baseQuantity: pillsSold,
            availableStock: 150,
            unitSellPrice: 0.25,
            unitBuyPrice: 0.12,
          }),
        ],
        form: makeBillForm({ paymentMethod: 'cash', paidAmount: pillsSold * 0.25 }),
      });
    }
    return { purchase, purchaseItems };
  }

  it('blocks returning a full box to the supplier once some pills were sold', async () => {
    const { purchase, purchaseItems } = await buyOneBoxThenSellPills(140); // 10 pills left
    await expect(
      returnPurchaseItem({ purchaseId: purchase.id, itemId: purchaseItems[0].id, quantity: 150, reason: 'overstock' }),
    ).rejects.toMatchObject({ code: AppErrorCode.PURCHASE_RETURN_INSUFFICIENT_STOCK });
  });

  it('blocks voiding the purchase once some of its stock was sold', async () => {
    const { purchase } = await buyOneBoxThenSellPills(10); // 140 pills left, 10 sold
    await expect(voidPurchase({ purchaseId: purchase.id, reason: 'entered twice' })).rejects.toMatchObject({
      code: AppErrorCode.PURCHASE_VOID_INSUFFICIENT_STOCK,
    });
    // The purchase stays finalized and stock is unchanged by the rejected void.
    await expect(db.purchases.get(purchase.id)).resolves.toMatchObject({ status: 'finalized' });
    await expect(db.products.get('acamol')).resolves.toMatchObject({ quantityInStock: 140 });
  });
});

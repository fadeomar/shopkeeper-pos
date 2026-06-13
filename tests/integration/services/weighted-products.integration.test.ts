import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/schema';
import { calculateInventoryCostValue } from '@/lib/services/inventory-lot-service';
import {
  makeBillDraftItem,
  makeBillForm,
  makeProduct,
  makePurchaseDraftItem,
  makePurchaseForm,
} from '@/tests/helpers/builders';
import { resetTestDb, seedProduct, seedSettings } from '@/tests/helpers/db';
import type { Product } from '@/types/domain';

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
const { createFinalizedPurchase } = await import('@/lib/services/purchase-service');

/** A weight product: quantityInStock is grams, buy/sell prices are per kg. */
function makeWeightProduct(overrides: Partial<Product> = {}): Product {
  return makeProduct({
    id: 'tomatoes',
    name: 'Tomatoes',
    unit: 'kg',
    saleType: 'weight',
    quantityInStock: 0,
    buyPrice: 0,
    sellPrice: 5,
    ...overrides,
  });
}

/** Buy `kg` of a weight product at `costPerKg` (creates a gram lot). */
async function buyWeight(product: Product, kg: number, costPerKg: number) {
  return createFinalizedPurchase({
    items: [
      makePurchaseDraftItem(product, {
        saleType: 'weight',
        quantity: kg,
        baseQuantity: kg * 1000,
        unitCost: costPerKg,
      }),
    ],
    form: makePurchaseForm({ paidAmount: kg * costPerKg }),
  });
}

describe('weighted products', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestDb();
    await seedSettings({ allowLossSale: true });
  });

  it('creates a gram lot with per-kg cost from a weighted purchase', async () => {
    const product = await seedProduct(makeWeightProduct());
    const result = await buyWeight(product, 100, 3);

    await expect(db.products.get('tomatoes')).resolves.toMatchObject({
      quantityInStock: 100000, // grams
      buyPrice: 3, // per kg
    });

    const lots = await db.inventoryLots.where('productId').equals('tomatoes').toArray();
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({
      baseUnit: 'gram',
      quantityReceived: 100000,
      quantityRemaining: 100000,
      unitCost: 3, // per kg
      sourceId: result.purchase.id,
    });
    // Inventory value = 100 kg × 3 = 300, not 100000 × 3.
    await expect(calculateInventoryCostValue()).resolves.toBe(300);
  });

  // The headline acceptance example.
  it('allocates FIFO across gram lots and costs COGS by actual lot weight', async () => {
    const product = await seedProduct(makeWeightProduct());
    await buyWeight(product, 50, 3); // lot A: 50 kg @ 3
    const live1 = (await db.products.get('tomatoes')) as Product;
    await buyWeight(live1, 70, 3.5); // lot B: 70 kg @ 3.5

    const live2 = (await db.products.get('tomatoes')) as Product;
    const sale = await createFinalizedBill({
      items: [
        makeBillDraftItem(live2, {
          saleType: 'weight',
          quantity: 60, // kg
          baseQuantity: 60000, // grams
          unitSellPrice: 5,
        }),
      ],
      form: makeBillForm({ paidAmount: 300 }),
    });

    const item = sale.billItems[0];
    // Revenue 60×5=300, COGS 50×3 + 10×3.5 = 185, profit 115.
    expect(item.lineSubtotal).toBe(300);
    expect(item.lineProfit).toBe(115);
    expect(item.saleType).toBe('weight');
    expect(item.quantitySold).toBe(60); // kg
    expect(item.baseQuantitySold).toBe(60000); // grams
    // Weighted-average cost per kg = 185 / 60 ≈ 3.08.
    expect(item.unitBuyPriceAtSale).toBe(3.08);
    expect(sale.bill.totalProfit).toBe(115);

    // 60 kg remaining: lot A fully depleted, lot B down to 60 kg.
    await expect(db.products.get('tomatoes')).resolves.toMatchObject({ quantityInStock: 60000 });
    const lots = (await db.inventoryLots.where('productId').equals('tomatoes').toArray()).sort(
      (a, b) => a.receivedAt.localeCompare(b.receivedAt),
    );
    expect(lots[0]).toMatchObject({ quantityRemaining: 0, status: 'depleted' });
    expect(lots[1]).toMatchObject({ quantityRemaining: 60000, status: 'open' });
  });

  it('blocks a weighted sale that exceeds available grams and writes nothing', async () => {
    const product = await seedProduct(makeWeightProduct());
    await buyWeight(product, 1, 3); // only 1 kg = 1000 g

    const live = (await db.products.get('tomatoes')) as Product;
    await expect(
      createFinalizedBill({
        items: [makeBillDraftItem(live, { saleType: 'weight', quantity: 1.5, baseQuantity: 1500, unitSellPrice: 5 })],
        form: makeBillForm({ paidAmount: 7.5 }),
      }),
    ).rejects.toMatchObject({ code: 'PRODUCT_INSUFFICIENT_STOCK' });

    await expect(db.bills.count()).resolves.toBe(0);
    await expect(db.products.get('tomatoes')).resolves.toMatchObject({ quantityInStock: 1000 });
  });

  it('restores returned grams to the exact lot and costs the return by weight', async () => {
    const product = await seedProduct(makeWeightProduct());
    await buyWeight(product, 50, 3);
    const live1 = (await db.products.get('tomatoes')) as Product;
    await buyWeight(live1, 70, 3.5);

    const live2 = (await db.products.get('tomatoes')) as Product;
    const sale = await createFinalizedBill({
      items: [makeBillDraftItem(live2, { saleType: 'weight', quantity: 60, baseQuantity: 60000, unitSellPrice: 5 })],
      form: makeBillForm({ paidAmount: 300 }),
    });

    // Return 10 kg (10000 g). It peels off the most-recently consumed lot (B).
    await returnBillItem({ billId: sale.bill.id, itemId: sale.billItems[0].id, quantity: 10000, reason: 'damaged' });

    const item = await db.billItems.get(sale.billItems[0].id);
    expect(item?.quantityReturned).toBe(10); // kg
    expect(item?.baseQuantityReturned).toBe(10000); // grams

    const lots = (await db.inventoryLots.where('productId').equals('tomatoes').toArray()).sort(
      (a, b) => a.receivedAt.localeCompare(b.receivedAt),
    );
    expect(lots[1].quantityRemaining).toBe(70000); // 60kg + 10kg returned
    await expect(db.products.get('tomatoes')).resolves.toMatchObject({ quantityInStock: 70000 });

    const bill = await db.bills.get(sale.bill.id);
    // Returned profit costed at lot B's 3.5/kg: 10×(5−3.5) = 15.
    expect(bill?.returnedProfit).toBe(15);
    expect(bill?.status).toBe('partially_returned');
  });

  it('void restores every gram to its original lot', async () => {
    const product = await seedProduct(makeWeightProduct());
    await buyWeight(product, 50, 3);
    const live1 = (await db.products.get('tomatoes')) as Product;
    await buyWeight(live1, 70, 3.5);

    const live2 = (await db.products.get('tomatoes')) as Product;
    const sale = await createFinalizedBill({
      items: [makeBillDraftItem(live2, { saleType: 'weight', quantity: 60, baseQuantity: 60000, unitSellPrice: 5 })],
      form: makeBillForm({ paidAmount: 300 }),
    });

    await voidBill({ billId: sale.bill.id, reason: 'cancelled' });

    const lots = (await db.inventoryLots.where('productId').equals('tomatoes').toArray()).sort(
      (a, b) => a.receivedAt.localeCompare(b.receivedAt),
    );
    expect(lots[0].quantityRemaining).toBe(50000);
    expect(lots[1].quantityRemaining).toBe(70000);
    await expect(db.products.get('tomatoes')).resolves.toMatchObject({ quantityInStock: 120000 });
    await expect(db.bills.get(sale.bill.id)).resolves.toMatchObject({ status: 'voided' });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorCode } from '@/lib/errors/app-error';
import { db } from '@/lib/db/schema';
import { buildOpeningLot } from '@/lib/db/inventory-lot-migration';
import { calculateInventoryCostValue } from '@/lib/services/inventory-lot-service';
import { summarizeProductSales } from '@/features/reports/utils/report-summary';
import {
  makeBillDraftItem,
  makeBillForm,
  makeProduct,
  makePurchaseDraftItem,
  makePurchaseForm,
} from '@/tests/helpers/builders';
import { resetTestDb, seedProduct, seedSettings } from '@/tests/helpers/db';
import type { Bill, BillItem, InventoryLot, Product } from '@/types/domain';

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
const accountData = await import('@/lib/services/account-data-service');

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

/**
 * Seed a product whose stock is backed by explicit FIFO lots (in given order).
 * Bypasses the seedProduct helper so the test fully controls lot costs/order.
 */
async function seedProductWithLots(
  productOverrides: Partial<Product>,
  lots: Array<{ qty: number; cost: number }>,
): Promise<{ product: Product; lotIds: string[] }> {
  const quantityInStock = lots.reduce((sum, lot) => sum + lot.qty, 0);
  const product = makeProduct({ ...productOverrides, quantityInStock });
  await db.products.put(product);

  const lotIds: string[] = [];
  for (let i = 0; i < lots.length; i += 1) {
    const id = `lot-${product.id}-${i}`;
    const receivedAt = `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`;
    const lot: InventoryLot = {
      id,
      productId: product.id,
      sourceType: 'purchase',
      sourceId: `seed-purchase-${i}`,
      sourceItemId: `seed-item-${i}`,
      sourceLabel: `Seed lot ${i}`,
      receivedAt,
      quantityReceived: lots[i].qty,
      quantityRemaining: lots[i].qty,
      unitCost: lots[i].cost,
      status: 'open',
      createdAt: receivedAt,
      updatedAt: receivedAt,
      syncStatus: 'pending',
    };
    await db.inventoryLots.put(lot);
    lotIds.push(id);
  }
  return { product, lotIds };
}

describe('FIFO inventory lots', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestDb();
    await seedSettings();
  });

  // 1. Migration / opening lot behavior
  it('builds an opening lot from an existing product with stock', () => {
    const product = makeProduct({ quantityInStock: 50, buyPrice: 8 });
    const lot = buildOpeningLot(product, '2026-02-01T00:00:00.000Z');
    expect(lot).toMatchObject({
      sourceType: 'opening_balance',
      quantityReceived: 50,
      quantityRemaining: 50,
      unitCost: 8,
      status: 'open',
    });
    expect(buildOpeningLot(makeProduct({ quantityInStock: 0 }), '2026-02-01T00:00:00.000Z')).toBeNull();
  });

  // 2. Purchase creates lot and updates product
  it('creates an inventory lot from a finalized purchase and updates product', async () => {
    const product = await seedProduct({ id: 'p2', quantityInStock: 0, buyPrice: 0, sellPrice: 20 });

    const result = await createFinalizedPurchase({
      items: [makePurchaseDraftItem(product, { quantity: 100, unitCost: 10 })],
      form: makePurchaseForm({ paidAmount: 1000 }),
    });

    await expect(db.products.get('p2')).resolves.toMatchObject({ quantityInStock: 100, buyPrice: 10 });

    const lots = await db.inventoryLots.where('productId').equals('p2').toArray();
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({
      sourceType: 'purchase',
      sourceId: result.purchase.id,
      sourceItemId: result.purchaseItems[0].id,
      quantityReceived: 100,
      quantityRemaining: 100,
      unitCost: 10,
      status: 'open',
    });
    expect(result.purchaseItems[0].unitCostAtPurchase).toBe(10);
  });

  // 3. FIFO sale consumes oldest lots and computes exact profit
  it('consumes oldest lots first and computes exact weighted-average profit', async () => {
    const { product, lotIds } = await seedProductWithLots(
      { id: 'p3', buyPrice: 13, sellPrice: 17 },
      [{ qty: 100, cost: 10 }, { qty: 100, cost: 13 }],
    );

    const result = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 120, unitSellPrice: 17 })],
      form: makeBillForm({ paidAmount: 2040 }),
    });

    await expect(db.inventoryLots.get(lotIds[0])).resolves.toMatchObject({ quantityRemaining: 0, status: 'depleted' });
    await expect(db.inventoryLots.get(lotIds[1])).resolves.toMatchObject({ quantityRemaining: 80, status: 'open' });
    await expect(db.products.get('p3')).resolves.toMatchObject({ quantityInStock: 80 });

    const allocations = await db.billItemCostAllocations.where('billItemId').equals(result.billItems[0].id).toArray();
    expect(allocations).toHaveLength(2);
    expect(allocations.find((a) => a.inventoryLotId === lotIds[0])).toMatchObject({ quantity: 100, unitCost: 10 });
    expect(allocations.find((a) => a.inventoryLotId === lotIds[1])).toMatchObject({ quantity: 20, unitCost: 13 });

    expect(result.billItems[0]).toMatchObject({
      quantitySold: 120,
      lineSubtotal: 2040,
      lineProfit: 780,
      unitBuyPriceAtSale: 10.5,
    });
    expect(result.bill).toMatchObject({ totalAmount: 2040, totalProfit: 780 });
  });

  // 4. New purchase price must not corrupt old stock profit
  it('costs a sale against the old cheaper lot, not the latest buy price', async () => {
    const { product } = await seedProductWithLots({ id: 'p4', buyPrice: 10, sellPrice: 15 }, [{ qty: 30, cost: 10 }]);

    // A later purchase at a higher cost bumps buyPrice to 13.
    await createFinalizedPurchase({
      items: [makePurchaseDraftItem(product, { quantity: 100, unitCost: 13 })],
      form: makePurchaseForm({ paidAmount: 1300 }),
    });
    await expect(db.products.get('p4')).resolves.toMatchObject({ buyPrice: 13 });

    const live = await db.products.get('p4');
    const result = await createFinalizedBill({
      items: [makeBillDraftItem(live as Product, { quantity: 30, unitSellPrice: 15 })],
      form: makeBillForm({ paidAmount: 450 }),
    });

    // 30 × (15 − 10) = 150, NOT 30 × (15 − 13) = 60.
    expect(result.billItems[0].lineProfit).toBe(150);
    expect(result.billItems[0].unitBuyPriceAtSale).toBe(10);
    expect(result.bill.totalProfit).toBe(150);
  });

  // 5. Insufficient lot stock blocks sale
  it('blocks a sale that exceeds available lot stock and writes nothing', async () => {
    const product = await seedProduct({ id: 'p5', quantityInStock: 10, buyPrice: 4, sellPrice: 9 });

    await expectAppError(
      createFinalizedBill({
        items: [makeBillDraftItem(product, { quantity: 11, unitSellPrice: 9 })],
        form: makeBillForm({ paidAmount: 99 }),
      }),
      AppErrorCode.PRODUCT_INSUFFICIENT_STOCK,
    );

    await expect(db.bills.count()).resolves.toBe(0);
    await expect(db.billItemCostAllocations.count()).resolves.toBe(0);
    await expect(db.products.get('p5')).resolves.toMatchObject({ quantityInStock: 10 });
    const lots = await db.inventoryLots.where('productId').equals('p5').toArray();
    expect(lots[0].quantityRemaining).toBe(10);
  });

  // 6. Return restores exact consumed lot
  it('restores a return to the exact (newest-consumed) lot with exact cost', async () => {
    const { product, lotIds } = await seedProductWithLots(
      { id: 'p6', buyPrice: 13, sellPrice: 17 },
      [{ qty: 100, cost: 10 }, { qty: 100, cost: 13 }],
    );

    const sale = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 120, unitSellPrice: 17 })],
      form: makeBillForm({ paidAmount: 2040 }),
    });

    await returnBillItem({ billId: sale.bill.id, itemId: sale.billItems[0].id, quantity: 10, reason: 'damaged' });

    // Return peels off Lot 2 (the most recently consumed) first.
    await expect(db.inventoryLots.get(lotIds[1])).resolves.toMatchObject({ quantityRemaining: 90 });
    const allocations = await db.billItemCostAllocations.where('billItemId').equals(sale.billItems[0].id).toArray();
    expect(allocations.find((a) => a.inventoryLotId === lotIds[1])).toMatchObject({ quantityReturned: 10 });
    await expect(db.products.get('p6')).resolves.toMatchObject({ quantityInStock: 90 });

    const bill = await db.bills.get(sale.bill.id);
    // Returned profit costed at the actual lot cost 13: 10×(17−13) = 40.
    expect(bill?.returnedProfit).toBe(40);
    expect(bill?.status).toBe('partially_returned');
    const moves = await db.stockMovements.where('referenceId').equals(sale.bill.id).toArray();
    expect(moves.some((m) => m.movementType === 'return' && m.quantityChange === 10)).toBe(true);
  });

  // 7. Void bill restores the consumed allocations to their exact lots.
  // (voidBill only accepts finalized bills — a partially-returned bill can no
  // longer be voided — so this exercises the full-restore path across lots.)
  it('void restores every consumed unit to its exact lot', async () => {
    const { product, lotIds } = await seedProductWithLots(
      { id: 'p7', buyPrice: 13, sellPrice: 17 },
      [{ qty: 100, cost: 10 }, { qty: 100, cost: 13 }],
    );

    const sale = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 120, unitSellPrice: 17 })],
      form: makeBillForm({ paidAmount: 2040 }),
    });

    await voidBill({ billId: sale.bill.id, reason: 'cancelled' });

    await expect(db.inventoryLots.get(lotIds[0])).resolves.toMatchObject({ quantityRemaining: 100 });
    await expect(db.inventoryLots.get(lotIds[1])).resolves.toMatchObject({ quantityRemaining: 100 });
    await expect(db.products.get('p7')).resolves.toMatchObject({ quantityInStock: 200 });

    const allocations = await db.billItemCostAllocations.where('billItemId').equals(sale.billItems[0].id).toArray();
    for (const allocation of allocations) {
      expect(allocation.quantityReturned).toBe(allocation.quantity);
    }
    await expect(db.bills.get(sale.bill.id)).resolves.toMatchObject({ status: 'voided' });
  });

  // 8. Purchase return blocks if lot was already sold
  it('blocks a purchase return when some of the lot was already sold', async () => {
    const product = await seedProduct({ id: 'p8', quantityInStock: 0, buyPrice: 0, sellPrice: 15 });
    const purchase = await createFinalizedPurchase({
      items: [makePurchaseDraftItem(product, { quantity: 100, unitCost: 10 })],
      form: makePurchaseForm({ paidAmount: 1000 }),
    });

    const live = await db.products.get('p8');
    await createFinalizedBill({
      items: [makeBillDraftItem(live as Product, { quantity: 80, unitSellPrice: 15 })],
      form: makeBillForm({ paidAmount: 1200 }),
    });

    await expectAppError(
      returnPurchaseItem({
        purchaseId: purchase.purchase.id,
        itemId: purchase.purchaseItems[0].id,
        quantity: 50,
        reason: 'overstock',
      }),
      AppErrorCode.PURCHASE_RETURN_INSUFFICIENT_STOCK,
    );

    const lots = await db.inventoryLots.where('sourceItemId').equals(purchase.purchaseItems[0].id).toArray();
    expect(lots[0].quantityRemaining).toBe(20);
    await expect(db.products.get('p8')).resolves.toMatchObject({ quantityInStock: 20 });
  });

  // 9. Purchase void blocks if any quantity already sold
  it('blocks a purchase void when any units were already sold', async () => {
    const product = await seedProduct({ id: 'p9', quantityInStock: 0, buyPrice: 0, sellPrice: 15 });
    const purchase = await createFinalizedPurchase({
      items: [makePurchaseDraftItem(product, { quantity: 100, unitCost: 10 })],
      form: makePurchaseForm({ paidAmount: 1000 }),
    });

    const live = await db.products.get('p9');
    await createFinalizedBill({
      items: [makeBillDraftItem(live as Product, { quantity: 1, unitSellPrice: 15 })],
      form: makeBillForm({ paidAmount: 15 }),
    });

    await expectAppError(
      voidPurchase({ purchaseId: purchase.purchase.id, reason: 'mistake' }),
      AppErrorCode.PURCHASE_VOID_INSUFFICIENT_STOCK,
    );

    await expect(db.purchases.get(purchase.purchase.id)).resolves.toMatchObject({ status: 'finalized' });
    const lots = await db.inventoryLots.where('sourceItemId').equals(purchase.purchaseItems[0].id).toArray();
    expect(lots[0].quantityRemaining).toBe(99);
    await expect(db.products.get('p9')).resolves.toMatchObject({ quantityInStock: 99 });
  });

  // 9b. Loss-sale validation costs against the actual FIFO lot, not buyPrice.
  // Scenario A: old lot is cheap (cost 2), product.buyPrice is high (5).
  // Selling at 3 must be ALLOWED with allowLossSale=false because the real
  // FIFO cost consumed is 2 — the latest buyPrice 5 is irrelevant.
  it('allows a sale below latest buyPrice when the consumed FIFO lot cost is lower', async () => {
    await seedSettings({ allowLossSale: false });
    const { product } = await seedProductWithLots({ id: 'pA', buyPrice: 5, sellPrice: 3 }, [{ qty: 10, cost: 2 }]);

    const result = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 1, unitSellPrice: 3 })],
      form: makeBillForm({ paidAmount: 3 }),
    });

    // 1 × (3 − 2) = 1.
    expect(result.billItems[0].lineProfit).toBe(1);
    expect(result.billItems[0].unitBuyPriceAtSale).toBe(2);
    await expect(db.products.get('pA')).resolves.toMatchObject({ quantityInStock: 9 });
  });

  // Scenario B: old lot is expensive (cost 5), product.buyPrice is now low (2).
  // Selling at 3 must be BLOCKED with allowLossSale=false because the real
  // FIFO cost consumed is 5 — selling at 3 is a genuine loss. Nothing persists.
  it('blocks a sale above latest buyPrice when the consumed FIFO lot cost is higher, and writes nothing', async () => {
    await seedSettings({ allowLossSale: false });
    const { product, lotIds } = await seedProductWithLots({ id: 'pB', buyPrice: 2, sellPrice: 3 }, [{ qty: 10, cost: 5 }]);

    await expectAppError(
      createFinalizedBill({
        items: [makeBillDraftItem(product, { quantity: 1, unitSellPrice: 3 })],
        form: makeBillForm({ paidAmount: 3 }),
      }),
      AppErrorCode.PRODUCT_LOSS_SALE_BLOCKED,
    );

    // Transaction rolled back: no bill, no allocation, lot untouched.
    await expect(db.bills.count()).resolves.toBe(0);
    await expect(db.billItemCostAllocations.count()).resolves.toBe(0);
    await expect(db.inventoryLots.get(lotIds[0])).resolves.toMatchObject({ quantityRemaining: 10, status: 'open' });
    await expect(db.products.get('pB')).resolves.toMatchObject({ quantityInStock: 10 });
  });

  // 10. Inventory cost value uses lots, not latest buyPrice
  it('computes inventory cost value from lots, not the latest buy price', async () => {
    await seedProductWithLots({ id: 'p10', buyPrice: 13 }, [{ qty: 30, cost: 10 }, { qty: 100, cost: 13 }]);
    // 30×10 + 100×13 = 1600 (NOT 130×13 = 1690).
    await expect(calculateInventoryCostValue()).resolves.toBe(1600);
  });

  // 11. Old bill fallback still works
  it('falls back to unitBuyPriceAtSale for bills that have no allocations', () => {
    const product = makeProduct({ id: 'p11' });
    const bill = {
      id: 'old-bill',
      status: 'finalized',
      subtotal: 150,
      discountAmount: 0,
      taxAmount: 0,
    } as Bill;
    const item = {
      id: 'old-item',
      billId: 'old-bill',
      originalProductId: 'p11',
      barcodeAtSale: product.barcode,
      productNameAtSale: product.name,
      categoryAtSale: product.category,
      itemKind: 'product',
      quantitySold: 10,
      quantityReturned: 0,
      unitBuyPriceAtSale: 10,
      unitSellPriceAtSale: 15,
      lineSubtotal: 150,
      lineProfit: 50,
      createdAt: '2026-01-01T00:00:00.000Z',
    } as BillItem;

    // No allocations passed → legacy snapshot cost path.
    const rows = summarizeProductSales([bill], [item], [product], []);
    const row = rows.find((r) => r.key === 'p11');
    expect(row?.revenue).toBe(150);
    expect(row?.profit).toBe(50);
  });

  // 12. Account snapshot includes the new tables
  it('includes inventory lots and cost allocations in account snapshot/restore', async () => {
    const { product } = await seedProductWithLots({ id: 'p12', buyPrice: 10, sellPrice: 20 }, [{ qty: 50, cost: 10 }]);
    const sale = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 5, unitSellPrice: 20 })],
      form: makeBillForm({ paidAmount: 100 }),
    });
    expect(sale.billItems[0].lineProfit).toBe(50);

    const lotCount = await db.inventoryLots.count();
    const allocCount = await db.billItemCostAllocations.count();
    expect(lotCount).toBeGreaterThan(0);
    expect(allocCount).toBeGreaterThan(0);

    accountData.setActiveUid('user-snapshot');
    await accountData.saveCurrentAccountSnapshot('user-snapshot');

    await db.inventoryLots.clear();
    await db.billItemCostAllocations.clear();
    await expect(db.inventoryLots.count()).resolves.toBe(0);

    await accountData.restoreAccountSnapshot('user-snapshot');

    await expect(db.inventoryLots.count()).resolves.toBe(lotCount);
    await expect(db.billItemCostAllocations.count()).resolves.toBe(allocCount);
  });
});

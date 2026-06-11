import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorCode } from '@/lib/errors/app-error';
import { db } from '@/lib/db/schema';
import { getSyncQueueId } from '@/lib/services/sync-queue-service';
import { MISC_ITEM_CATEGORY, MISC_ITEM_ID_PREFIX } from '@/lib/utils/misc-items';
import { makePurchaseDraftItem, makePurchaseForm } from '@/tests/helpers/builders';
import { resetTestDb, seedProduct, seedSettings } from '@/tests/helpers/db';
import type { PurchaseDraftItem } from '@/types/domain';

vi.mock('@/lib/services/subscription-service', () => ({
  assertSubscriptionCanWrite: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/audit-service', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

const { createFinalizedPurchase, returnPurchaseItem, voidPurchase } = await import('@/lib/services/purchase-service');

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('purchase-service integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestDb();
    await seedSettings();
  });

  it('finalizes a cash purchase, increments stock, records stock movement, and advances only purchase sequence', async () => {
    const product = await seedProduct({ quantityInStock: 3, buyPrice: 4, sellPrice: 7 });

    const result = await createFinalizedPurchase({
      items: [makePurchaseDraftItem(product, { quantity: 5, unitCost: 4 })],
      form: makePurchaseForm({ paidAmount: 25 }),
    });

    expect(result.purchase.purchaseNumber).toBe('PO-000001');
    expect(result.purchase.subtotal).toBe(20);
    expect(result.purchase.totalAmount).toBe(20);
    expect(result.purchase.cashAmount).toBe(20);
    expect(result.purchase.paidAmount).toBe(25);
    expect(result.purchase.changeAmount).toBe(5);
    expect(result.purchase.itemCount).toBe(5);

    await expect(db.products.get(product.id)).resolves.toMatchObject({
      quantityInStock: 8,
      syncStatus: 'pending',
    });
    await expect(db.settings.get('app-settings')).resolves.toMatchObject({
      nextBillSequence: 1,
      nextPurchaseSequence: 2,
      syncStatus: 'pending',
    });

    const movements = await db.stockMovements.toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      productId: product.id,
      movementType: 'purchase',
      quantityChange: 5,
      referenceType: 'purchase',
      referenceId: result.purchase.id,
      syncStatus: 'pending',
    });

    const queue = await db.syncQueue.toArray();
    expect(queue.map((job) => [job.entity, job.entityId, job.operation, job.status])).toEqual(
      expect.arrayContaining([
        ['purchase', result.purchase.id, 'create', 'pending'],
        ['stockMovement', movements[0].id, 'create', 'pending'],
        ['settings', 'app-settings', 'upsert', 'pending'],
      ]),
    );
    await expect(db.syncQueue.get(getSyncQueueId('settings', 'app-settings'))).resolves.toMatchObject({
      payload: { source: 'purchase-sequence' },
    });
  });

  it('creates/reuses a supplier for credit purchases and stores supplier payable in creditAmount', async () => {
    const product = await seedProduct({ quantityInStock: 1, buyPrice: 6, sellPrice: 10 });

    const first = await createFinalizedPurchase({
      items: [makePurchaseDraftItem(product, { quantity: 3, unitCost: 6 })],
      form: makePurchaseForm({
        paymentMethod: 'credit',
        paidAmount: 4,
        supplierName: 'Main Supplier',
        supplierPhone: '+970 599-333-444',
      }),
    });
    const supplier = await db.suppliers.toCollection().first();

    expect(supplier).toMatchObject({
      name: 'Main Supplier',
      phone: '+970 599-333-444',
      normalizedPhone: '970599333444',
      syncStatus: 'pending',
    });
    expect(first.purchase).toMatchObject({
      paymentMethod: 'credit',
      supplierId: supplier?.id,
      cashAmount: 4,
      cardAmount: 0,
      creditAmount: 14,
      paidAmount: 4,
      changeAmount: 0,
    });

    const second = await createFinalizedPurchase({
      items: [makePurchaseDraftItem(product, { quantity: 1, unitCost: 6 })],
      form: makePurchaseForm({
        paymentMethod: 'credit',
        paidAmount: 0,
        supplierName: 'Main Supplier New Name',
        supplierPhone: '970599333444',
      }),
    });

    await expect(db.suppliers.count()).resolves.toBe(1);
    await expect(db.suppliers.get(supplier!.id)).resolves.toMatchObject({ name: 'Main Supplier New Name' });
    expect(second.purchase.supplierId).toBe(supplier?.id);

    const supplierSyncJob = await db.syncQueue.get(getSyncQueueId('supplier', supplier!.id));
    expect(supplierSyncJob).toMatchObject({ entity: 'supplier', operation: 'upsert', status: 'pending' });
  });

  it('rejects unsafe purchase submissions before writing purchase or inventory records', async () => {
    const product = await seedProduct({ quantityInStock: 2, status: 'inactive' });

    await expectAppError(
      createFinalizedPurchase({
        items: [makePurchaseDraftItem(product, { quantity: 1, unitCost: 4 })],
        form: makePurchaseForm({ paidAmount: 4 }),
      }),
      AppErrorCode.PRODUCT_INACTIVE,
    );
    await expectAppError(
      createFinalizedPurchase({
        items: [makePurchaseDraftItem({ ...product, status: 'active' }, { quantity: 1, unitCost: 4 })],
        form: makePurchaseForm({ paymentMethod: 'cash', paidAmount: 3 }),
      }),
      AppErrorCode.PURCHASE_PAID_TOO_LOW,
    );
    await expectAppError(
      createFinalizedPurchase({
        items: [makePurchaseDraftItem({ ...product, status: 'active' }, { quantity: 1, unitCost: 4 })],
        form: makePurchaseForm({ paymentMethod: 'credit', paidAmount: 0, supplierName: '', supplierPhone: '' }),
      }),
      AppErrorCode.PURCHASE_CREDIT_NEEDS_SUPPLIER,
    );
    await expectAppError(
      createFinalizedPurchase({
        items: [makePurchaseDraftItem({ ...product, status: 'active' }, { quantity: 1, unitCost: 4 })],
        form: makePurchaseForm({ paymentMethod: 'mixed', paidAmount: 4 }),
      }),
      AppErrorCode.PAYMENT_METHOD_DISABLED,
    );

    await expect(db.purchases.count()).resolves.toBe(0);
    await expect(db.stockMovements.count()).resolves.toBe(0);
    await expect(db.products.get(product.id)).resolves.toMatchObject({ quantityInStock: 2 });
  });

  it('keeps misc purchase lines out of product stock and stock movements while storing the cost line', async () => {
    const product = await seedProduct({ quantityInStock: 4, buyPrice: 5, sellPrice: 8 });
    const miscLine: PurchaseDraftItem = {
      productId: `${MISC_ITEM_ID_PREFIX}_delivery`,
      barcode: 'MISC',
      name: 'متفرقات شراء',
      category: MISC_ITEM_CATEGORY,
      itemKind: 'misc',
      miscDescription: 'Supplier delivery fee',
      currentStock: 0,
      quantity: 1,
      unitCost: 3,
      unitSellPriceBefore: 0,
    };

    const result = await createFinalizedPurchase({
      items: [makePurchaseDraftItem(product, { quantity: 2, unitCost: 5 }), miscLine],
      form: makePurchaseForm({ paidAmount: 20 }),
    });

    expect(result.purchase.totalAmount).toBe(13);
    await expect(db.products.get(product.id)).resolves.toMatchObject({ quantityInStock: 6 });

    const items = await db.purchaseItems.where('purchaseId').equals(result.purchase.id).toArray();
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.itemKind === 'misc')).toMatchObject({
      productNameAtPurchase: 'متفرقات شراء',
      miscDescription: 'Supplier delivery fee',
      lineSubtotal: 3,
      quantityPurchased: 1,
    });
    const movements = await db.stockMovements.toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0].productId).toBe(product.id);
  });

  it('returns purchase items by removing returned stock and updating purchase status', async () => {
    const product = await seedProduct({ quantityInStock: 2, buyPrice: 4, sellPrice: 8 });
    const result = await createFinalizedPurchase({
      items: [makePurchaseDraftItem(product, { quantity: 5, unitCost: 4 })],
      form: makePurchaseForm({ paidAmount: 20 }),
    });
    const [item] = result.purchaseItems;

    await returnPurchaseItem({
      purchaseId: result.purchase.id,
      itemId: item.id,
      quantity: 2,
      reason: 'Damaged on delivery',
    });

    await expect(db.products.get(product.id)).resolves.toMatchObject({ quantityInStock: 5 });
    await expect(db.purchaseItems.get(item.id)).resolves.toMatchObject({ quantityReturned: 2 });
    await expect(db.purchases.get(result.purchase.id)).resolves.toMatchObject({
      status: 'partially_returned',
      returnedAmount: 8,
    });
  });

  it('voids finalized purchases by removing all purchased stock and locking the purchase as voided', async () => {
    const product = await seedProduct({ quantityInStock: 2, buyPrice: 4, sellPrice: 8 });
    const result = await createFinalizedPurchase({
      items: [makePurchaseDraftItem(product, { quantity: 5, unitCost: 4 })],
      form: makePurchaseForm({ paidAmount: 20 }),
    });
    const [item] = result.purchaseItems;

    await voidPurchase({ purchaseId: result.purchase.id, reason: 'Duplicate purchase' });

    await expect(db.products.get(product.id)).resolves.toMatchObject({ quantityInStock: 2 });
    await expect(db.purchases.get(result.purchase.id)).resolves.toMatchObject({
      status: 'voided',
      returnedAmount: 20,
    });
    await expect(db.purchaseItems.get(item.id)).resolves.toMatchObject({ quantityReturned: 5 });
  });
});

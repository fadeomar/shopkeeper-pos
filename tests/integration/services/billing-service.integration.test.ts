import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorCode } from '@/lib/errors/app-error';
import { db } from '@/lib/db/schema';
import { getSyncQueueId } from '@/lib/services/sync-queue-service';
import { MISC_ITEM_CATEGORY, MISC_ITEM_ID_PREFIX } from '@/lib/utils/misc-items';
import { makeBillDraftItem, makeBillForm } from '@/tests/helpers/builders';
import { resetTestDb, seedProduct, seedSettings } from '@/tests/helpers/db';
import type { BillDraftItem } from '@/types/domain';

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
const { assertPermission, getCurrentPermissions } = await import('@/lib/services/permission-service');

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

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('billing-service integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestDb();
    await seedSettings();
  });

  it('finalizes a cash bill, decrements product stock, records stock movement, and queues sync jobs', async () => {
    const product = await seedProduct({ quantityInStock: 10, buyPrice: 3, sellPrice: 8 });

    const result = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 2 })],
      form: makeBillForm({ paidAmount: 20 }),
    });

    expect(result.bill.billNumber).toBe('INV-000001');
    expect(result.bill.subtotal).toBe(16);
    expect(result.bill.totalAmount).toBe(16);
    expect(result.bill.cashAmount).toBe(16);
    expect(result.bill.paidAmount).toBe(20);
    expect(result.bill.changeAmount).toBe(4);
    expect(result.bill.totalProfit).toBe(10);
    expect(result.bill.itemCount).toBe(2);

    await expect(db.products.get(product.id)).resolves.toMatchObject({
      quantityInStock: 8,
      syncStatus: 'pending',
    });
    await expect(db.settings.get('app-settings')).resolves.toMatchObject({
      nextBillSequence: 2,
      nextPurchaseSequence: 1,
      syncStatus: 'pending',
    });

    const movements = await db.stockMovements.toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      productId: product.id,
      movementType: 'sale',
      quantityChange: -2,
      referenceType: 'bill',
      referenceId: result.bill.id,
      syncStatus: 'pending',
    });

    const queue = await db.syncQueue.toArray();
    expect(queue.map((job) => [job.entity, job.entityId, job.operation, job.status])).toEqual(
      expect.arrayContaining([
        ['bill', result.bill.id, 'create', 'pending'],
        ['stockMovement', movements[0].id, 'create', 'pending'],
        ['settings', 'app-settings', 'upsert', 'pending'],
      ]),
    );
    await expect(db.syncQueue.get(getSyncQueueId('settings', 'app-settings'))).resolves.toMatchObject({
      payload: { source: 'bill-sequence' },
    });
  });

  it('creates/reuses a customer for credit bills and stores the owed amount in creditAmount', async () => {
    const product = await seedProduct({ quantityInStock: 5, sellPrice: 10 });

    const first = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 2 })],
      form: makeBillForm({
        paymentMethod: 'credit',
        paidAmount: 5,
        customerName: 'Ali Market',
        customerPhone: '+970 599-111-222',
      }),
    });
    const customer = await db.customers.toCollection().first();

    expect(customer).toMatchObject({
      name: 'Ali Market',
      phone: '+970 599-111-222',
      normalizedPhone: '970599111222',
      syncStatus: 'pending',
    });
    expect(first.bill).toMatchObject({
      paymentMethod: 'credit',
      customerId: customer?.id,
      cashAmount: 5,
      cardAmount: 0,
      creditAmount: 15,
      paidAmount: 5,
      changeAmount: 0,
    });

    const second = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 1 })],
      form: makeBillForm({
        paymentMethod: 'credit',
        paidAmount: 0,
        customerName: 'Ali Market New Name',
        customerPhone: '970599111222',
      }),
    });

    await expect(db.customers.count()).resolves.toBe(1);
    await expect(db.customers.get(customer!.id)).resolves.toMatchObject({ name: 'Ali Market New Name' });
    expect(second.bill.customerId).toBe(customer?.id);

    const customerSyncJob = await db.syncQueue.get(getSyncQueueId('customer', customer!.id));
    expect(customerSyncJob).toMatchObject({ entity: 'customer', operation: 'upsert', status: 'pending' });
  });

  it('rejects unsafe bill submissions before writing any inventory or bill records', async () => {
    const product = await seedProduct({ quantityInStock: 1, buyPrice: 9, sellPrice: 10 });

    await expectAppError(
      createFinalizedBill({
        items: [makeBillDraftItem(product, { quantity: 2 })],
        form: makeBillForm({ paidAmount: 20 }),
      }),
      AppErrorCode.PRODUCT_INSUFFICIENT_STOCK,
    );
    await expectAppError(
      createFinalizedBill({
        items: [makeBillDraftItem(product, { quantity: 1, unitSellPrice: 8 })],
        form: makeBillForm({ paidAmount: 8 }),
      }),
      AppErrorCode.PRODUCT_LOSS_SALE_BLOCKED,
    );
    await expectAppError(
      createFinalizedBill({
        items: [makeBillDraftItem(product, { quantity: 1 })],
        form: makeBillForm({ paymentMethod: 'credit', paidAmount: 0, customerName: '', customerPhone: '' }),
      }),
      AppErrorCode.BILL_CREDIT_NEEDS_CUSTOMER,
    );
    await expectAppError(
      createFinalizedBill({
        items: [makeBillDraftItem(product, { quantity: 1 })],
        form: makeBillForm({ paymentMethod: 'mixed', paidAmount: 10 }),
      }),
      AppErrorCode.PAYMENT_METHOD_DISABLED,
    );

    await expect(db.bills.count()).resolves.toBe(0);
    await expect(db.stockMovements.count()).resolves.toBe(0);
    await expect(db.products.get(product.id)).resolves.toMatchObject({ quantityInStock: 1 });
  });

  it('blocks a below-FIFO-cost sale when allowLossSale is on but the user lacks canEditCost', async () => {
    // Store permits loss sales, but below-cost selling also requires the
    // per-user canEditCost privilege (mirrors the POS UI's canSellBelowCost).
    // A stale/manipulated cart from a no-cost user must still be rejected.
    await seedSettings({ allowLossSale: true });
    const product = await seedProduct({ quantityInStock: 1, buyPrice: 9, sellPrice: 10 });

    denyCostEditOnce();
    await expectAppError(
      createFinalizedBill({
        items: [makeBillDraftItem(product, { quantity: 1, unitSellPrice: 8 })],
        form: makeBillForm({ paidAmount: 8 }),
      }),
      AppErrorCode.PRODUCT_LOSS_SALE_BLOCKED,
    );

    // Nothing persisted — the guard throws before any write commits.
    await expect(db.bills.count()).resolves.toBe(0);
    await expect(db.stockMovements.count()).resolves.toBe(0);
    await expect(db.products.get(product.id)).resolves.toMatchObject({ quantityInStock: 1 });

    // With canEditCost (default mock), the same below-cost sale goes through.
    const result = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 1, unitSellPrice: 8 })],
      form: makeBillForm({ paidAmount: 8 }),
    });
    expect(result.bill.totalAmount).toBe(8);
    await expect(db.products.get(product.id)).resolves.toMatchObject({ quantityInStock: 0 });
  });

  it('keeps misc bill lines out of product stock and stock movements while storing the line snapshot', async () => {
    const product = await seedProduct({ quantityInStock: 4, sellPrice: 8 });
    const miscLine: BillDraftItem = {
      productId: `${MISC_ITEM_ID_PREFIX}_snacks`,
      barcode: 'MISC',
      name: 'متفرقات',
      category: MISC_ITEM_CATEGORY,
      itemKind: 'misc',
      miscDescription: 'Kids candy',
      availableStock: 0,
      quantity: 3,
      unitBuyPrice: 0,
      unitSellPrice: 2,
    };

    const result = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 1 }), miscLine],
      form: makeBillForm({ paidAmount: 20 }),
    });

    expect(result.bill.totalAmount).toBe(14);
    expect(result.bill.totalProfit).toBe(3);
    await expect(db.products.get(product.id)).resolves.toMatchObject({ quantityInStock: 3 });

    const items = await db.billItems.where('billId').equals(result.bill.id).toArray();
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.itemKind === 'misc')).toMatchObject({
      productNameAtSale: 'متفرقات',
      miscDescription: 'Kids candy',
      lineProfit: 0,
      quantitySold: 3,
    });
    const movements = await db.stockMovements.toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0].productId).toBe(product.id);
  });

  it('returns bill items by reversing only the returned stock and updating bill status', async () => {
    const product = await seedProduct({ quantityInStock: 10, buyPrice: 2, sellPrice: 5 });
    const result = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 4 })],
      form: makeBillForm({ paidAmount: 20 }),
    });
    const [item] = result.billItems;

    await returnBillItem({
      billId: result.bill.id,
      itemId: item.id,
      quantity: 1,
      reason: 'Customer changed mind',
    });

    await expect(db.products.get(product.id)).resolves.toMatchObject({ quantityInStock: 7 });
    await expect(db.billItems.get(item.id)).resolves.toMatchObject({ quantityReturned: 1 });
    await expect(db.bills.get(result.bill.id)).resolves.toMatchObject({
      status: 'partially_returned',
      returnedAmount: 5,
      returnedProfit: 3,
    });
  });

  it('voids finalized bills by restoring all sold stock and locking the bill as voided', async () => {
    const product = await seedProduct({ quantityInStock: 10, buyPrice: 2, sellPrice: 5 });
    const result = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 4 })],
      form: makeBillForm({ paidAmount: 20 }),
    });
    const [item] = result.billItems;

    await voidBill({ billId: result.bill.id, reason: 'Wrong bill' });

    await expect(db.products.get(product.id)).resolves.toMatchObject({ quantityInStock: 10 });
    await expect(db.bills.get(result.bill.id)).resolves.toMatchObject({
      status: 'voided',
      returnedAmount: 20,
    });
    await expect(db.billItems.get(item.id)).resolves.toMatchObject({ quantityReturned: 4 });
    expect(assertPermission).toHaveBeenCalledWith('canVoid');
  });
});

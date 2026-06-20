import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorCode } from '@/lib/errors/app-error';
import { db } from '@/lib/db/schema';
import { getSyncQueueId } from '@/lib/services/sync-queue-service';
import { makeProduct } from '@/tests/helpers/builders';
import { resetTestDb, seedProduct } from '@/tests/helpers/db';

const permissionMocks = vi.hoisted(() => ({
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

vi.mock('@/lib/services/subscription-service', () => ({
  assertSubscriptionCanWrite: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/permission-service', () => permissionMocks);

vi.mock('@/lib/services/audit-service', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

const {
  adjustProductStock,
  countProductStock,
  createProductWithInitialMovement,
  receiveProductStock,
  updateProductDetails,
} = await import('@/lib/services/inventory-service');
const { assertPermission, getCurrentPermissions } = await import('@/lib/services/permission-service');

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('inventory-service integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    permissionMocks.getCurrentPermissions.mockResolvedValue({
      canVoid: true,
      canReturn: true,
      canDiscount: true,
      canViewProfit: true,
      canEditCost: true,
      canExport: true,
      canManageSettings: true,
      canManageRolePermissions: true,
    });
    await resetTestDb();
  });

  it('creates products with initial stock movement and queues product + movement sync jobs', async () => {
    const product = makeProduct({ id: 'product-new', quantityInStock: 7, buyPrice: 4.5 });

    await createProductWithInitialMovement(product);

    await expect(db.products.get(product.id)).resolves.toMatchObject({
      id: product.id,
      quantityInStock: 7,
      buyPrice: 4.5,
      syncStatus: 'pending',
    });

    const movements = await db.stockMovements.toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      productId: product.id,
      movementType: 'initial',
      quantityChange: 7,
      referenceType: 'product',
      referenceId: product.id,
      syncStatus: 'pending',
    });

    const queue = await db.syncQueue.toArray();
    expect(queue.map((job) => [job.entity, job.entityId, job.operation, job.status])).toEqual(
      expect.arrayContaining([
        ['product', product.id, 'create', 'pending'],
        ['stockMovement', movements[0].id, 'create', 'pending'],
      ]),
    );
  });

  it('strips buy price on product creation when the current role cannot edit costs', async () => {
    permissionMocks.getCurrentPermissions.mockResolvedValueOnce({
      canVoid: true,
      canReturn: true,
      canDiscount: true,
      canViewProfit: false,
      canEditCost: false,
      canExport: false,
      canManageSettings: false,
      canManageRolePermissions: false,
    });
    const product = makeProduct({ id: 'product-no-cost', quantityInStock: 0, buyPrice: 99 });

    await createProductWithInitialMovement(product);

    expect(getCurrentPermissions).toHaveBeenCalled();
    await expect(db.products.get(product.id)).resolves.toMatchObject({ buyPrice: 0 });
    await expect(db.stockMovements.count()).resolves.toBe(0);
  });

  it('updates product details without letting stale caller quantity overwrite live stock', async () => {
    const liveProduct = await seedProduct({ id: 'product-live', quantityInStock: 12, buyPrice: 3 });
    const staleCallerProduct = { ...liveProduct, quantityInStock: 1 };

    await updateProductDetails(staleCallerProduct, {
      name: 'Updated name',
      quantityInStock: 999,
      buyPrice: 4,
    });

    expect(assertPermission).toHaveBeenCalledWith('canEditCost');
    await expect(db.products.get(liveProduct.id)).resolves.toMatchObject({
      name: 'Updated name',
      quantityInStock: 12,
      buyPrice: 4,
      syncStatus: 'pending',
    });
    await expect(db.syncQueue.get(getSyncQueueId('product', liveProduct.id))).resolves.toMatchObject({
      entity: 'product',
      operation: 'update',
      status: 'pending',
    });
  });

  it('adjusts stock from the live product row, validates whole-number changes, and queues movement sync', async () => {
    const product = await seedProduct({ id: 'product-adjust', quantityInStock: 5 });

    await expectAppError(adjustProductStock(product, 0, 'noop'), AppErrorCode.STOCK_ADJ_ZERO_OR_WHOLE);
    await expectAppError(adjustProductStock(product, 1.5, 'fraction'), AppErrorCode.STOCK_ADJ_ZERO_OR_WHOLE);
    await expectAppError(adjustProductStock(product, -6, 'negative'), AppErrorCode.STOCK_ADJ_NEGATIVE_RESULT);

    await adjustProductStock({ ...product, quantityInStock: 99 }, -2, 'Damaged items', 'damaged');

    await expect(db.products.get(product.id)).resolves.toMatchObject({
      quantityInStock: 3,
      syncStatus: 'pending',
    });
    const [movement] = await db.stockMovements.toArray();
    expect(movement).toMatchObject({
      productId: product.id,
      movementType: 'damaged',
      quantityChange: -2,
      referenceType: 'adjustment',
      note: 'Damaged items',
      syncStatus: 'pending',
    });
    await expect(db.syncQueue.get(getSyncQueueId('stockMovement', movement.id))).resolves.toMatchObject({
      operation: 'create',
      status: 'pending',
    });
  });

  it('receives stock, optionally updates cost/supplier, and rejects invalid received quantities', async () => {
    const product = await seedProduct({ id: 'product-receive', quantityInStock: 2, buyPrice: 5 });

    await expectAppError(receiveProductStock(product, 0, 'invalid'), AppErrorCode.STOCK_RECEIVED_QTY_INVALID);
    await expectAppError(receiveProductStock(product, 2.5, 'invalid'), AppErrorCode.STOCK_RECEIVED_QTY_INVALID);

    await receiveProductStock(product, 6, 'Supplier delivery', 4.25, 'Main Supplier');

    await expect(db.products.get(product.id)).resolves.toMatchObject({
      quantityInStock: 8,
      buyPrice: 4.25,
      supplierName: 'Main Supplier',
      syncStatus: 'pending',
    });
    const [movement] = await db.stockMovements.toArray();
    expect(movement).toMatchObject({
      productId: product.id,
      movementType: 'purchase',
      quantityChange: 6,
      note: 'Supplier delivery',
      syncStatus: 'pending',
    });
  });

  it('counts stock as a correction movement and no-ops when counted quantity equals live stock', async () => {
    const product = await seedProduct({ id: 'product-count', quantityInStock: 10 });

    await expectAppError(countProductStock(product, -1, 'invalid'), AppErrorCode.STOCK_COUNTED_QTY_INVALID);
    await expectAppError(countProductStock(product, 3.25, 'invalid'), AppErrorCode.STOCK_COUNTED_QTY_INVALID);

    await countProductStock(product, 10, 'same count');
    await expect(db.stockMovements.count()).resolves.toBe(0);
    await expect(db.syncQueue.count()).resolves.toBe(0);

    await countProductStock(product, 13, 'physical count');

    await expect(db.products.get(product.id)).resolves.toMatchObject({ quantityInStock: 13 });
    const [movement] = await db.stockMovements.toArray();
    expect(movement).toMatchObject({
      productId: product.id,
      movementType: 'adjustment',
      quantityChange: 3,
      note: 'physical count',
    });
  });
});

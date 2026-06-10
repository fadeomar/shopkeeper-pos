import { AppError, AppErrorCode } from '@/lib/errors/app-error';
import { db } from '@/lib/db/schema';
import { createId } from '@/lib/utils/id';
import { nowIso } from '@/lib/utils/date';
import { buildSyncQueueItem } from '@/lib/services/sync-queue-service';
import { logAudit } from '@/lib/services/audit-service';
import { assertPermission, getCurrentPermissions } from '@/lib/services/permission-service';
import type { Product, StockMovement, StockMovementType } from '@/types/domain';
import { assertSubscriptionCanWrite } from '@/lib/services/subscription-service';

function requestSync(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('shopkeeper:sync-requested'));
  }
}

export async function createProductWithInitialMovement(product: Product) {
  await assertSubscriptionCanWrite();
  // Cost (buyPrice) is permission-gated. A user without canEditCost can still
  // create a product so cashiers can add SKUs on the fly — but they cannot set
  // a cost. Force buyPrice to 0 here as the service-layer backstop so a hidden
  // UI field, the quick-add modal, or a stale/direct caller can never slip a
  // non-zero cost through. Profit reports use historical bill-item snapshots,
  // so a 0 cost simply means "cost not set yet" until a manager edits it.
  const perms = await getCurrentPermissions();
  const safeBuyPrice = perms.canEditCost ? product.buyPrice : 0;
  const createdAt = nowIso();
  const productToSave: Product = {
    ...product,
    buyPrice: safeBuyPrice,
    syncStatus: 'pending',
    syncedAt: undefined,
    lastSyncError: undefined,
  };
  const movements: StockMovement[] = product.quantityInStock > 0
    ? [{
        id: createId('move'),
        productId: product.id,
        movementType: 'initial',
        quantityChange: product.quantityInStock,
        referenceType: 'product',
        referenceId: product.id,
        note: 'Initial stock on product creation',
        createdAt,
        syncStatus: 'pending',
      }]
    : [];

  await db.transaction('rw', db.products, db.stockMovements, db.syncQueue, async () => {
    await db.products.put(productToSave);
    if (movements.length) await db.stockMovements.bulkAdd(movements);
    await db.syncQueue.bulkPut([
      buildSyncQueueItem({ entity: 'product', entityId: product.id, operation: 'create' }),
      ...movements.map((movement) =>
        buildSyncQueueItem({ entity: 'stockMovement', entityId: movement.id, operation: 'create' }),
      ),
    ]);
  });
  requestSync();
}

export async function updateProductDetails(product: Product, changes: Partial<Product>) {
  await assertSubscriptionCanWrite();
  // Editing the cost (buy price) requires canEditCost. The product form already
  // hides the field for roles without it; this is the service-layer backstop.
  if (
    typeof changes.buyPrice === "number" &&
    changes.buyPrice !== product.buyPrice
  ) {
    await assertPermission("canEditCost");
  }

  const updatedAt = nowIso();
  await db.transaction('rw', db.products, db.syncQueue, async () => {
    await db.products.update(product.id, {
      ...changes,
      quantityInStock: product.quantityInStock,
      lastUpdated: updatedAt,
      syncStatus: 'pending',
      lastSyncError: undefined,
    });
    await db.syncQueue.put(buildSyncQueueItem({ entity: 'product', entityId: product.id, operation: 'update' }));
  });
  requestSync();
}

export async function adjustProductStock(
  product: Product,
  quantityChange: number,
  note: string,
  movementType: StockMovementType = 'adjustment',
) {
  await assertSubscriptionCanWrite();
  // The inventory model is integer-based (receiveProductStock and
  // countProductStock both enforce Number.isInteger). Matching here keeps
  // adjustment movements consistent and prevents fractional stock drift.
  if (!Number.isInteger(quantityChange) || quantityChange === 0) {
    throw new AppError(AppErrorCode.STOCK_ADJ_ZERO_OR_WHOLE);
  }

  const createdAt = nowIso();

  // Captured inside the transaction for the post-commit audit log entry.
  let auditProductName = '';

  await db.transaction('rw', db.products, db.stockMovements, db.syncQueue, async () => {
    const liveProduct = await db.products.get(product.id);
    if (!liveProduct) {
      throw new AppError(AppErrorCode.PRODUCT_NOT_FOUND);
    }
    auditProductName = liveProduct.name;

    const nextQuantity = liveProduct.quantityInStock + quantityChange;
    if (nextQuantity < 0) {
      throw new AppError(AppErrorCode.STOCK_ADJ_NEGATIVE_RESULT);
    }

    const movement: StockMovement = {
      id: createId('move'),
      productId: product.id,
      movementType,
      quantityChange,
      referenceType: 'adjustment',
      referenceId: product.id,
      note,
      createdAt,
      syncStatus: 'pending',
    };

    await db.products.update(product.id, {
      quantityInStock: nextQuantity,
      lastUpdated: createdAt,
      syncStatus: 'pending',
      lastSyncError: undefined,
    });

    await db.stockMovements.add(movement);
    await db.syncQueue.bulkPut([
      buildSyncQueueItem({ entity: 'product', entityId: product.id, operation: 'update' }),
      buildSyncQueueItem({ entity: 'stockMovement', entityId: movement.id, operation: 'create' }),
    ]);
  });
  requestSync();
  void logAudit({
    category: 'inventory',
    action: 'stock_adjust',
    entityId: product.id,
    entityLabel: auditProductName,
    summary: `${quantityChange > 0 ? '+' : ''}${quantityChange}`,
    reason: note,
  });
}


export async function receiveProductStock(
  product: Product,
  quantityReceived: number,
  note: string,
  buyPrice?: number,
  supplierName?: string,
) {
  await assertSubscriptionCanWrite();
  if (!Number.isInteger(quantityReceived) || quantityReceived <= 0) {
    throw new AppError(AppErrorCode.STOCK_RECEIVED_QTY_INVALID);
  }

  const createdAt = nowIso();

  let auditProductName = '';

  await db.transaction('rw', db.products, db.stockMovements, db.syncQueue, async () => {
    const liveProduct = await db.products.get(product.id);
    if (!liveProduct) {
      throw new AppError(AppErrorCode.PRODUCT_NOT_FOUND);
    }
    auditProductName = liveProduct.name;

    const changes: Partial<Product> = {
      quantityInStock: liveProduct.quantityInStock + quantityReceived,
      lastUpdated: createdAt,
      syncStatus: 'pending',
      lastSyncError: undefined,
    };

    if (typeof buyPrice === 'number' && Number.isFinite(buyPrice) && buyPrice >= 0) {
      changes.buyPrice = buyPrice;
    }
    if (supplierName?.trim()) {
      changes.supplierName = supplierName.trim();
    }

    const movement: StockMovement = {
      id: createId('move'),
      productId: product.id,
      movementType: 'purchase',
      quantityChange: quantityReceived,
      referenceType: 'adjustment',
      referenceId: product.id,
      note: note.trim() || `Received stock: +${quantityReceived}`,
      createdAt,
      syncStatus: 'pending',
    };

    await db.products.update(product.id, changes);
    await db.stockMovements.add(movement);
    await db.syncQueue.bulkPut([
      buildSyncQueueItem({ entity: 'product', entityId: product.id, operation: 'update' }),
      buildSyncQueueItem({ entity: 'stockMovement', entityId: movement.id, operation: 'create' }),
    ]);
  });
  requestSync();
  void logAudit({
    category: 'inventory',
    action: 'stock_adjust',
    entityId: product.id,
    entityLabel: auditProductName,
    summary: `+${quantityReceived} (received)`,
    reason: note.trim() || undefined,
  });
}

export async function countProductStock(
  product: Product,
  countedQuantity: number,
  note: string,
) {
  await assertSubscriptionCanWrite();
  if (!Number.isInteger(countedQuantity) || countedQuantity < 0) {
    throw new AppError(AppErrorCode.STOCK_COUNTED_QTY_INVALID);
  }

  const createdAt = nowIso();
  let auditDelta = 0;
  let auditProductName = product.name;

  await db.transaction('rw', db.products, db.stockMovements, db.syncQueue, async () => {
    const liveProduct = await db.products.get(product.id);
    if (!liveProduct) {
      throw new AppError(AppErrorCode.PRODUCT_NOT_FOUND);
    }
    auditProductName = liveProduct.name;

    const quantityChange = countedQuantity - liveProduct.quantityInStock;
    if (quantityChange === 0) {
      return;
    }
    auditDelta = quantityChange;

    const movement: StockMovement = {
      id: createId('move'),
      productId: product.id,
      movementType: 'adjustment',
      quantityChange,
      referenceType: 'adjustment',
      referenceId: product.id,
      note: note.trim() || `Stock count correction: ${liveProduct.quantityInStock} → ${countedQuantity}`,
      createdAt,
      syncStatus: 'pending',
    };

    await db.products.update(product.id, {
      quantityInStock: countedQuantity,
      lastUpdated: createdAt,
      syncStatus: 'pending',
      lastSyncError: undefined,
    });
    await db.stockMovements.add(movement);
    await db.syncQueue.bulkPut([
      buildSyncQueueItem({ entity: 'product', entityId: product.id, operation: 'update' }),
      buildSyncQueueItem({ entity: 'stockMovement', entityId: movement.id, operation: 'create' }),
    ]);
  });
  requestSync();
  if (auditDelta !== 0) {
    void logAudit({
      category: 'inventory',
      action: 'stock_adjust',
      entityId: product.id,
      entityLabel: auditProductName,
      summary: `counted: ${countedQuantity} (${auditDelta > 0 ? '+' : ''}${auditDelta})`,
      reason: note.trim() || undefined,
    });
  }
}

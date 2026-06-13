import { AppError, AppErrorCode } from '@/lib/errors/app-error';
import { db } from '@/lib/db/schema';
import { createId } from '@/lib/utils/id';
import { nowIso } from '@/lib/utils/date';
import { buildSyncQueueItem } from '@/lib/services/sync-queue-service';
import { logAudit } from '@/lib/services/audit-service';
import { assertPermission, getCurrentPermissions } from '@/lib/services/permission-service';
import type { InventoryLot, Product, StockMovement, StockMovementType } from '@/types/domain';
import { assertSubscriptionCanWrite } from '@/lib/services/subscription-service';
import {
  consumeLotsForNegativeAdjustment,
  createAdjustmentLot,
} from '@/lib/services/inventory-lot-service';
import { lotBaseUnitFor } from '@/lib/utils/weight';

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

  await db.transaction('rw', db.products, db.stockMovements, db.inventoryLots, db.syncQueue, async () => {
    await db.products.put(productToSave);
    if (movements.length) await db.stockMovements.bulkAdd(movements);
    // Under FIFO costing, initial stock must seed an inventory lot or the
    // product could never be sold (sales consume lots, not quantityInStock).
    let initialLot: InventoryLot | null = null;
    if (product.quantityInStock > 0) {
      initialLot = await createAdjustmentLot({
        productId: product.id,
        quantity: product.quantityInStock,
        unitCost: safeBuyPrice,
        sourceId: product.id,
        sourceLabel: 'Initial stock',
        // Weight products: quantityInStock is grams, buyPrice is per kg.
        baseUnit: lotBaseUnitFor(product.saleType),
        createdAt,
      });
    }
    await db.syncQueue.bulkPut([
      buildSyncQueueItem({ entity: 'product', entityId: product.id, operation: 'create' }),
      ...movements.map((movement) =>
        buildSyncQueueItem({ entity: 'stockMovement', entityId: movement.id, operation: 'create' }),
      ),
      ...(initialLot ? [buildSyncQueueItem({ entity: 'inventoryLot', entityId: initialLot.id, operation: 'create' })] : []),
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
    const liveProduct = await db.products.get(product.id);
    if (!liveProduct) {
      throw new AppError(AppErrorCode.PRODUCT_NOT_FOUND);
    }

    await db.products.update(product.id, {
      ...changes,
      // Product detail edits must never overwrite the live stock count with a
      // stale form/caller snapshot. Stock changes go through explicit stock
      // movement services only, so audit/history and sync stay coherent.
      quantityInStock: liveProduct.quantityInStock,
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

  await db.transaction('rw', db.products, db.stockMovements, db.inventoryLots, db.syncQueue, async () => {
    const liveProduct = await db.products.get(product.id);
    if (!liveProduct) {
      throw new AppError(AppErrorCode.PRODUCT_NOT_FOUND);
    }
    auditProductName = liveProduct.name;

    const nextQuantity = liveProduct.quantityInStock + quantityChange;
    if (nextQuantity < 0) {
      throw new AppError(AppErrorCode.STOCK_ADJ_NEGATIVE_RESULT);
    }

    // Keep FIFO lots in step with the cached stock count: a positive
    // adjustment creates a lot (at the product's current cost), a negative
    // one consumes oldest lots first.
    const lotSyncIds: string[] = [];
    if (quantityChange > 0) {
      const lot = await createAdjustmentLot({
        productId: product.id,
        quantity: quantityChange,
        unitCost: liveProduct.buyPrice,
        sourceId: product.id,
        sourceLabel: note?.trim() || 'Stock adjustment',
        baseUnit: lotBaseUnitFor(liveProduct.saleType),
        createdAt,
      });
      lotSyncIds.push(lot.id);
    } else if (quantityChange < 0) {
      const consumed = await consumeLotsForNegativeAdjustment({
        productId: product.id,
        quantity: -quantityChange,
        updatedAt: createdAt,
      });
      for (const lot of consumed) lotSyncIds.push(lot.id);
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
      ...lotSyncIds.map((lotId) =>
        buildSyncQueueItem({ entity: 'inventoryLot', entityId: lotId, operation: quantityChange > 0 ? 'create' : 'update' }),
      ),
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

  await db.transaction('rw', db.products, db.stockMovements, db.inventoryLots, db.syncQueue, async () => {
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

    const hasNewCost = typeof buyPrice === 'number' && Number.isFinite(buyPrice) && buyPrice >= 0;
    if (hasNewCost) {
      changes.buyPrice = buyPrice;
    }
    if (supplierName?.trim()) {
      changes.supplierName = supplierName.trim();
    }

    // Received stock is a new FIFO lot costed at the entered cost (or the
    // product's current buy price if none was provided).
    const lot = await createAdjustmentLot({
      productId: product.id,
      quantity: quantityReceived,
      unitCost: hasNewCost ? (buyPrice as number) : liveProduct.buyPrice,
      sourceId: product.id,
      sourceLabel: note.trim() || 'Received stock',
      baseUnit: lotBaseUnitFor(liveProduct.saleType),
      createdAt,
    });

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
      buildSyncQueueItem({ entity: 'inventoryLot', entityId: lot.id, operation: 'create' }),
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

  await db.transaction('rw', db.products, db.stockMovements, db.inventoryLots, db.syncQueue, async () => {
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

    // Reconcile lots with the counted total: count up adds a lot at the
    // current cost, count down consumes oldest lots first.
    const lotSyncIds: string[] = [];
    if (quantityChange > 0) {
      const lot = await createAdjustmentLot({
        productId: product.id,
        quantity: quantityChange,
        unitCost: liveProduct.buyPrice,
        sourceId: product.id,
        sourceLabel: note.trim() || 'Stock count',
        baseUnit: lotBaseUnitFor(liveProduct.saleType),
        createdAt,
      });
      lotSyncIds.push(lot.id);
    } else {
      const consumed = await consumeLotsForNegativeAdjustment({
        productId: product.id,
        quantity: -quantityChange,
        updatedAt: createdAt,
      });
      for (const lot of consumed) lotSyncIds.push(lot.id);
    }

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
      ...lotSyncIds.map((lotId) =>
        buildSyncQueueItem({ entity: 'inventoryLot', entityId: lotId, operation: quantityChange > 0 ? 'create' : 'update' }),
      ),
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

import { db } from '@/lib/db/schema';
import { createId } from '@/lib/utils/id';
import { nowIso } from '@/lib/utils/date';
import { buildSyncQueueItem } from '@/lib/services/sync-queue-service';
import type { Product, StockMovement, StockMovementType } from '@/types/domain';

function requestSync(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('shopkeeper:sync-requested'));
  }
}

export async function createProductWithInitialMovement(product: Product) {
  const createdAt = nowIso();
  const productToSave: Product = {
    ...product,
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
  const createdAt = nowIso();

  await db.transaction('rw', db.products, db.stockMovements, db.syncQueue, async () => {
    const liveProduct = await db.products.get(product.id);
    if (!liveProduct) {
      throw new Error('Product not found.');
    }

    const nextQuantity = liveProduct.quantityInStock + quantityChange;
    if (nextQuantity < 0) {
      throw new Error('Stock adjustment would make inventory negative.');
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
}


export async function receiveProductStock(
  product: Product,
  quantityReceived: number,
  note: string,
  buyPrice?: number,
  supplierName?: string,
) {
  if (!Number.isInteger(quantityReceived) || quantityReceived <= 0) {
    throw new Error('Received quantity must be a positive whole number.');
  }

  const createdAt = nowIso();

  await db.transaction('rw', db.products, db.stockMovements, db.syncQueue, async () => {
    const liveProduct = await db.products.get(product.id);
    if (!liveProduct) {
      throw new Error('Product not found.');
    }

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
}

export async function countProductStock(
  product: Product,
  countedQuantity: number,
  note: string,
) {
  if (!Number.isInteger(countedQuantity) || countedQuantity < 0) {
    throw new Error('Counted quantity must be a non-negative whole number.');
  }

  const createdAt = nowIso();

  await db.transaction('rw', db.products, db.stockMovements, db.syncQueue, async () => {
    const liveProduct = await db.products.get(product.id);
    if (!liveProduct) {
      throw new Error('Product not found.');
    }

    const quantityChange = countedQuantity - liveProduct.quantityInStock;
    if (quantityChange === 0) {
      return;
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
    ]);
  });
  requestSync();
}

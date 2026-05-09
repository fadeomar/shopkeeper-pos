import { db } from '@/lib/db/schema';
import { createId } from '@/lib/utils/id';
import { nowIso } from '@/lib/utils/date';
import { buildSyncQueueItem } from '@/lib/services/sync-queue-service';
import type { Product, StockMovement, StockMovementType } from '@/types/domain';

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
}

export async function updateProductDetails(product: Product, changes: Partial<Product>) {
  const updatedAt = nowIso();
  await db.transaction('rw', db.products, db.syncQueue, async () => {
    await db.products.update(product.id, {
      ...changes,
      quantityInStock: product.quantityInStock,
      lastUpdated: updatedAt,
      syncStatus: 'pending',
      syncedAt: undefined,
      lastSyncError: undefined,
    });
    await db.syncQueue.put(buildSyncQueueItem({ entity: 'product', entityId: product.id, operation: 'update' }));
  });
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
      syncedAt: undefined,
      lastSyncError: undefined,
    });

    await db.stockMovements.add(movement);
    await db.syncQueue.bulkPut([
      buildSyncQueueItem({ entity: 'product', entityId: product.id, operation: 'update' }),
      buildSyncQueueItem({ entity: 'stockMovement', entityId: movement.id, operation: 'create' }),
    ]);
  });
}

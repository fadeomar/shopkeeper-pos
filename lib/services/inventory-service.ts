import { db } from '@/lib/db/schema';
import { createId } from '@/lib/utils/id';
import { nowIso } from '@/lib/utils/date';
import type { Product, StockMovementType } from '@/types/domain';

export async function createProductWithInitialMovement(product: Product) {
  const createdAt = nowIso();

  await db.transaction('rw', db.products, db.stockMovements, async () => {
    await db.products.put(product);

    if (product.quantityInStock > 0) {
      await db.stockMovements.add({
        id: createId('move'),
        productId: product.id,
        movementType: 'initial',
        quantityChange: product.quantityInStock,
        referenceType: 'product',
        referenceId: product.id,
        note: 'Initial stock on product creation',
        createdAt,
      });
    }
  });
}

export async function updateProductDetails(product: Product, changes: Partial<Product>) {
  await db.products.update(product.id, {
    ...changes,
    quantityInStock: product.quantityInStock,
    lastUpdated: nowIso(),
  });
}

export async function adjustProductStock(product: Product, quantityChange: number, note: string, movementType: StockMovementType = 'adjustment') {
  const createdAt = nowIso();

  await db.transaction('rw', db.products, db.stockMovements, async () => {
    const liveProduct = await db.products.get(product.id);
    if (!liveProduct) {
      throw new Error('Product not found.');
    }

    const nextQuantity = liveProduct.quantityInStock + quantityChange;
    if (nextQuantity < 0) {
      throw new Error('Stock adjustment would make inventory negative.');
    }

    await db.products.update(product.id, {
      quantityInStock: nextQuantity,
      lastUpdated: createdAt,
    });

    await db.stockMovements.add({
      id: createId('move'),
      productId: product.id,
      movementType,
      quantityChange,
      referenceType: 'adjustment',
      referenceId: product.id,
      note,
      createdAt,
    });
  });
}

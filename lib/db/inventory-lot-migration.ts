import { createId } from '@/lib/utils/id';
import type { InventoryLot, Product } from '@/types/domain';

/**
 * Source id stamped on every opening lot created by the v16 FIFO migration.
 * Used to make the migration idempotent — if an opening lot already exists for
 * a product/source pair we never create a second one.
 */
export const OPENING_LOT_SOURCE_ID = 'migration-v16';

/**
 * Source id for an opening lot synthesized when a product is imported with
 * positive initial stock (CSV import). Lets the lot be told apart from a
 * migration- or purchase-created one in reports and diagnostics.
 */
export const IMPORT_OPENING_LOT_SOURCE_ID = 'import-opening';

/**
 * Source id for an opening lot synthesized during restore when legacy cloud
 * data has a product with stock but no lots. Idempotency marker — restore only
 * synthesizes for products that have no lots at all, so a re-run that has
 * already pulled the pushed lot back never makes a second one.
 */
export const RESTORE_OPENING_LOT_SOURCE_ID = 'legacy-opening-restore';

/**
 * Build the opening-balance inventory lot for a single existing product, or
 * `null` if the product carries no stock (we never create empty lots).
 *
 * Pure and dependency-free (no Dexie) so the v16 schema upgrade, the CSV
 * import, the restore fallback, and the unit tests can all exercise the exact
 * same opening-lot logic. `options` lets each caller stamp its own
 * source id/label while sharing the quantity/cost rules.
 */
export function buildOpeningLot(
  product: Product,
  now: string,
  options: { sourceId?: string; sourceLabel?: string } = {},
): InventoryLot | null {
  const quantity = Number(product.quantityInStock) || 0;
  if (quantity <= 0) return null;
  return {
    id: createId('lot'),
    productId: product.id,
    sourceType: 'opening_balance',
    sourceId: options.sourceId ?? OPENING_LOT_SOURCE_ID,
    sourceLabel: options.sourceLabel ?? 'Opening balance',
    receivedAt: product.dateAdded || product.lastUpdated || now,
    quantityReceived: quantity,
    quantityRemaining: quantity,
    // Best available cost for pre-FIFO stock: the product's last known buyPrice.
    unitCost: Number(product.buyPrice) || 0,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'pending',
  };
}

/**
 * CRUD for `ProductUnit` rows (the sellable/purchasable units of a multi_unit
 * product). Mirrors inventory-service.ts: every write goes to Dexie first and
 * enqueues a `productUnit` sync job; reads in components go through
 * `useLiveQuery(db.productUnits…)` directly.
 *
 * Reconciliation policy (see saveProductUnits):
 *  - a unit removed from the form is SOFT-DISABLED (canSell/canPurchase = false),
 *    never hard-deleted — the app has no cloud-delete path and uses
 *    "deactivate, don't delete" everywhere (products go inactive too). Disabled
 *    units drop out of the POS/purchase selectors but keep historical bills and
 *    the stock breakdown coherent.
 *  - changing a unit's `conversionToBase` after it has been used on a bill or
 *    purchase is blocked (PRODUCT_UNIT_CONVERSION_LOCKED) — that would silently
 *    rewrite the base-unit meaning of past stock math.
 */
import { AppError, AppErrorCode } from '@/lib/errors/app-error';
import { db } from '@/lib/db/schema';
import { createId } from '@/lib/utils/id';
import { nowIso } from '@/lib/utils/date';
import { buildSyncQueueItem } from '@/lib/services/sync-queue-service';
import { logAudit } from '@/lib/services/audit-service';
import { assertSubscriptionCanWrite } from '@/lib/services/subscription-service';
import { validateUnitDrafts } from '@/lib/utils/multi-unit';
import type { Product, ProductUnit } from '@/types/domain';

function requestSync(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('shopkeeper:sync-requested'));
  }
}

/** Non-reactive read of a product's units (sync paths, services). */
export async function listProductUnits(productId: string): Promise<ProductUnit[]> {
  return db.productUnits.where('productId').equals(productId).toArray();
}

/** A unit definition coming from the product form (id optional for new rows). */
export interface ProductUnitInput {
  id?: string;
  name: string;
  conversionToBase: number;
  sellPrice: number;
  buyPrice?: number;
  barcode?: string;
  canSell: boolean;
  canPurchase: boolean;
  isDefaultSaleUnit?: boolean;
  createdAt?: string;
}

/**
 * Materialize a form draft into a full ProductUnit row, assigning an id and
 * timestamps when missing. The returned id lets the caller wire
 * `Product.defaultSaleUnitId` before the product itself is saved.
 */
export function buildProductUnit(
  productId: string,
  input: ProductUnitInput,
  sortOrder: number,
  now: string = nowIso(),
): ProductUnit {
  return {
    id: input.id ?? createId('punit'),
    productId,
    name: input.name.trim(),
    conversionToBase: Math.round(input.conversionToBase),
    sellPrice: input.sellPrice,
    buyPrice: input.buyPrice,
    barcode: input.barcode?.trim() || undefined,
    canSell: input.canSell,
    canPurchase: input.canPurchase,
    isDefaultSaleUnit: input.isDefaultSaleUnit,
    sortOrder,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    syncStatus: 'pending',
    syncedAt: undefined,
    lastSyncError: undefined,
  };
}

/** Does any bill or purchase line reference this unit? (conversion-lock guard) */
async function unitHasHistory(unitId: string): Promise<boolean> {
  const billUse = await db.billItems
    .filter((item) => item.saleUnitIdAtSale === unitId)
    .first();
  if (billUse) return true;
  const purchaseUse = await db.purchaseItems
    .filter((item) => item.purchaseUnitIdAtPurchase === unitId)
    .first();
  return Boolean(purchaseUse);
}

/**
 * Reconcile a multi_unit product's full unit set against what is stored.
 * Creates new units, upserts existing ones (blocking unsafe conversion
 * changes), and soft-disables any stored unit no longer present in `units`.
 */
export async function saveProductUnits(input: {
  product: Pick<Product, 'id' | 'name'>;
  units: ProductUnit[];
}): Promise<void> {
  await assertSubscriptionCanWrite();

  const issues = validateUnitDrafts(input.units);
  if (issues.length > 0) {
    throw new AppError(AppErrorCode.PRODUCT_UNIT_INVALID, { name: input.product.name });
  }

  const now = nowIso();
  await db.transaction(
    'rw',
    [db.productUnits, db.billItems, db.purchaseItems, db.syncQueue],
    async () => {
      const existing = await db.productUnits
        .where('productId')
        .equals(input.product.id)
        .toArray();
      const existingById = new Map(existing.map((unit) => [unit.id, unit]));
      const desiredIds = new Set(input.units.map((unit) => unit.id));
      const jobs = [];

      for (const unit of input.units) {
        const prior = existingById.get(unit.id);
        if (prior && prior.conversionToBase !== unit.conversionToBase) {
          if (await unitHasHistory(unit.id)) {
            throw new AppError(AppErrorCode.PRODUCT_UNIT_CONVERSION_LOCKED, {
              name: unit.name,
            });
          }
        }
        const row: ProductUnit = {
          ...unit,
          productId: input.product.id,
          createdAt: prior?.createdAt ?? unit.createdAt ?? now,
          updatedAt: now,
          syncStatus: 'pending',
          syncedAt: undefined,
          lastSyncError: undefined,
        };
        await db.productUnits.put(row);
        jobs.push(
          buildSyncQueueItem({
            entity: 'productUnit',
            entityId: unit.id,
            operation: prior ? 'upsert' : 'create',
          }),
        );
      }

      // Soft-disable units the form dropped (keep the row for history/breakdown).
      for (const prior of existing) {
        if (desiredIds.has(prior.id)) continue;
        if (!prior.canSell && !prior.canPurchase) continue; // already disabled
        await db.productUnits.update(prior.id, {
          canSell: false,
          canPurchase: false,
          isDefaultSaleUnit: false,
          updatedAt: now,
          syncStatus: 'pending',
          lastSyncError: undefined,
        });
        jobs.push(
          buildSyncQueueItem({
            entity: 'productUnit',
            entityId: prior.id,
            operation: 'upsert',
          }),
        );
      }

      await db.syncQueue.bulkPut(jobs);
    },
  );

  requestSync();
  void logAudit({
    category: 'product',
    action: 'update',
    entityId: input.product.id,
    entityLabel: input.product.name,
    summary: `units: ${input.units.length}`,
  });
}

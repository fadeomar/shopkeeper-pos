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
import { assertPermission, getCurrentPermissions } from '@/lib/services/permission-service';
import { createAdjustmentLot } from '@/lib/services/inventory-lot-service';
import { validateUnitDrafts } from '@/lib/utils/multi-unit';
import { normalizeBarcode } from '@/lib/utils/barcode';
import { lotBaseUnitFor } from '@/lib/utils/weight';
import type { Product, ProductUnit, StockMovement } from '@/types/domain';

type SyncJob = ReturnType<typeof buildSyncQueueItem>;

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
 * ProductUnit barcodes share the same scanner namespace as product barcodes.
 * A duplicate across any product/unit would make scan-to-product ambiguous, so
 * this is enforced in the service layer (UI validation is only a convenience).
 */
async function assertUniqueProductUnitBarcodes(input: {
  productId: string;
  units: ProductUnit[];
}): Promise<void> {
  const wanted = input.units
    .map((unit) => ({ id: unit.id, barcode: normalizeBarcode(unit.barcode ?? '') }))
    .filter((row) => row.barcode);
  if (wanted.length === 0) return;

  const [products, allUnits] = await Promise.all([
    db.products.toArray(),
    db.productUnits.toArray(),
  ]);
  const productBarcodeOwner = new Map<string, string>();
  for (const product of products) {
    const barcode = normalizeBarcode(product.barcode);
    if (barcode) productBarcodeOwner.set(barcode, product.id);
  }
  const unitBarcodeOwner = new Map<string, string>();
  for (const unit of allUnits) {
    const barcode = normalizeBarcode(unit.barcode ?? '');
    if (barcode) unitBarcodeOwner.set(barcode, unit.id);
  }

  for (const row of wanted) {
    const productOwner = productBarcodeOwner.get(row.barcode);
    if (productOwner) {
      throw new AppError(AppErrorCode.PRODUCT_UNIT_BARCODE_DUPLICATE, {
        barcode: row.barcode,
      });
    }
    const unitOwner = unitBarcodeOwner.get(row.barcode);
    if (unitOwner && unitOwner !== row.id) {
      throw new AppError(AppErrorCode.PRODUCT_UNIT_BARCODE_DUPLICATE, {
        barcode: row.barcode,
      });
    }
  }
}

/**
 * A product's own barcode shares the scanner namespace with product-unit
 * barcodes. Ensure it doesn't collide with a unit barcode owned by ANOTHER
 * product — otherwise scanning that code is ambiguous (the POS would match the
 * product and silently shadow the other product's unit). The product↔product
 * clash is enforced separately (productRepo.findByBarcode). Service backstop
 * for the product-form check.
 */
export async function assertProductBarcodeUnique(input: {
  productId: string;
  barcode: string;
}): Promise<void> {
  const barcode = normalizeBarcode(input.barcode ?? '');
  if (!barcode) return;
  const units = await db.productUnits.toArray();
  const clash = units.find(
    (unit) =>
      unit.productId !== input.productId &&
      normalizeBarcode(unit.barcode ?? '') === barcode,
  );
  if (clash) {
    throw new AppError(AppErrorCode.PRODUCT_UNIT_BARCODE_DUPLICATE, { barcode });
  }
}

/**
 * Reconcile a product's full unit set against what is stored — the shared core
 * of saveProductUnits and saveMultiUnitProductWithUnits. MUST run inside an
 * active Dexie 'rw' transaction whose scope includes products, productUnits,
 * billItems, purchaseItems, and syncQueue. Returns the sync jobs to enqueue so
 * the caller can bulkPut them together with its own (product/movement/lot) jobs
 * in the same transaction. Throws PRODUCT_UNIT_CONVERSION_LOCKED if a used
 * unit's conversion changed.
 */
async function reconcileProductUnitsTx(
  productId: string,
  units: ProductUnit[],
  now: string,
): Promise<SyncJob[]> {
  const existing = await db.productUnits.where('productId').equals(productId).toArray();
  const existingById = new Map(existing.map((unit) => [unit.id, unit]));
  const desiredIds = new Set(units.map((unit) => unit.id));
  const jobs: SyncJob[] = [];

  for (const unit of units) {
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
      productId,
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

  return jobs;
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

  await assertUniqueProductUnitBarcodes({
    productId: input.product.id,
    units: input.units,
  });

  const now = nowIso();
  await db.transaction(
    'rw',
    [db.products, db.productUnits, db.billItems, db.purchaseItems, db.syncQueue],
    async () => {
      const jobs = await reconcileProductUnitsTx(input.product.id, input.units, now);
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

/**
 * Atomically create OR update a multi_unit product together with its units.
 *
 * Replaces the two-call sequence (createProductWithInitialMovement /
 * updateProductDetails, then saveProductUnits) that could leave a partial state
 * if the second call failed — e.g. a product saved as multi_unit with no valid
 * units, or repriced units with a stale product row. Everything — the product
 * row, its opening stock movement + FIFO lot (create only), and the full unit
 * reconcile — lives in ONE Dexie transaction, so any failure rolls all of it
 * back. Validation, permission, and barcode-uniqueness checks run up front.
 */
export async function saveMultiUnitProductWithUnits(
  input:
    | { mode: 'create'; product: Product; units: ProductUnit[] }
    | { mode: 'update'; product: Product; changes: Partial<Product>; units: ProductUnit[] },
): Promise<void> {
  await assertSubscriptionCanWrite();

  const issues = validateUnitDrafts(input.units);
  if (issues.length > 0) {
    throw new AppError(AppErrorCode.PRODUCT_UNIT_INVALID, { name: input.product.name });
  }

  // Cost (buyPrice) is permission-gated, mirroring inventory-service: on create
  // a user without canEditCost saves a 0 cost; on update they cannot change it.
  const perms = await getCurrentPermissions();
  if (input.mode === 'update') {
    const wantsBuyPriceChange =
      typeof input.changes.buyPrice === 'number' &&
      input.changes.buyPrice !== input.product.buyPrice;
    if (wantsBuyPriceChange) await assertPermission('canEditCost');
  }

  await assertUniqueProductUnitBarcodes({
    productId: input.product.id,
    units: input.units,
  });
  // The product's own barcode must not collide with another product's unit.
  const productBarcode =
    input.mode === 'update' ? input.changes.barcode ?? input.product.barcode : input.product.barcode;
  await assertProductBarcodeUnique({ productId: input.product.id, barcode: productBarcode });
  // …nor with one of THIS product's own incoming units. On create the product
  // isn't in the DB yet, so assertUniqueProductUnitBarcodes (which compares
  // units against stored product barcodes) can't catch it — check the input
  // set directly. Product barcode takes scanner precedence, so an overlap would
  // silently shadow the unit. UI blocks this; this backstops direct callers.
  const normalizedProductBarcode = normalizeBarcode(productBarcode ?? '');
  if (
    normalizedProductBarcode &&
    input.units.some(
      (unit) => normalizeBarcode(unit.barcode ?? '') === normalizedProductBarcode,
    )
  ) {
    throw new AppError(AppErrorCode.PRODUCT_UNIT_BARCODE_DUPLICATE, {
      barcode: normalizedProductBarcode,
    });
  }

  const now = nowIso();
  await db.transaction(
    'rw',
    [db.products, db.productUnits, db.stockMovements, db.inventoryLots, db.billItems, db.purchaseItems, db.syncQueue],
    async () => {
      const jobs: SyncJob[] = [];

      // Cost backstop (mirrors product.buyPrice gating): a user without
      // canEditCost cannot set or change a unit's buyPrice. On create their unit
      // costs are dropped; on update each unit keeps its stored cost. UI hides
      // these fields already — this guarantees it at the service layer too.
      let unitsToSave = input.units;
      if (!perms.canEditCost) {
        if (input.mode === 'create') {
          unitsToSave = input.units.map((u) => ({ ...u, buyPrice: undefined }));
        } else {
          const existing = await db.productUnits
            .where('productId')
            .equals(input.product.id)
            .toArray();
          const priorBuyPrice = new Map(existing.map((u) => [u.id, u.buyPrice]));
          unitsToSave = input.units.map((u) => ({ ...u, buyPrice: priorBuyPrice.get(u.id) }));
        }
      }

      if (input.mode === 'create') {
        const safeBuyPrice = perms.canEditCost ? input.product.buyPrice : 0;
        const productToSave: Product = {
          ...input.product,
          buyPrice: safeBuyPrice,
          syncStatus: 'pending',
          syncedAt: undefined,
          lastSyncError: undefined,
        };
        await db.products.put(productToSave);
        jobs.push(buildSyncQueueItem({ entity: 'product', entityId: input.product.id, operation: 'create' }));

        if (input.product.quantityInStock > 0) {
          const movement: StockMovement = {
            id: createId('move'),
            productId: input.product.id,
            movementType: 'initial',
            quantityChange: input.product.quantityInStock,
            referenceType: 'product',
            referenceId: input.product.id,
            note: 'Initial stock on product creation',
            createdAt: now,
            syncStatus: 'pending',
          };
          await db.stockMovements.add(movement);
          jobs.push(buildSyncQueueItem({ entity: 'stockMovement', entityId: movement.id, operation: 'create' }));
          // Seed the opening FIFO lot — sales consume lots, not quantityInStock.
          const lot = await createAdjustmentLot({
            productId: input.product.id,
            quantity: input.product.quantityInStock,
            unitCost: safeBuyPrice,
            sourceId: input.product.id,
            sourceLabel: 'Initial stock',
            baseUnit: lotBaseUnitFor(input.product.saleType),
            createdAt: now,
          });
          jobs.push(buildSyncQueueItem({ entity: 'inventoryLot', entityId: lot.id, operation: 'create' }));
        }
      } else {
        const live = await db.products.get(input.product.id);
        if (!live) throw new AppError(AppErrorCode.PRODUCT_NOT_FOUND);
        await db.products.update(input.product.id, {
          ...input.changes,
          // Detail edits never overwrite live stock — that's stock-movement only.
          quantityInStock: live.quantityInStock,
          lastUpdated: now,
          syncStatus: 'pending',
          lastSyncError: undefined,
        });
        jobs.push(buildSyncQueueItem({ entity: 'product', entityId: input.product.id, operation: 'update' }));
      }

      jobs.push(...(await reconcileProductUnitsTx(input.product.id, unitsToSave, now)));
      await db.syncQueue.bulkPut(jobs);
    },
  );

  requestSync();
  void logAudit({
    category: 'product',
    action: input.mode === 'create' ? 'create' : 'update',
    entityId: input.product.id,
    entityLabel: input.product.name,
    summary: `multi-unit, units: ${input.units.length}`,
  });
}

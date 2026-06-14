/**
 * inventory-lot-service — the FIFO costing engine.
 *
 * Accounting rules enforced here (this is core business logic — read before
 * changing):
 *
 *  1. Stock is tracked as discrete *lots*. Each lot is a batch received at a
 *     known unit cost (a purchase line, the v16 opening balance, or a positive
 *     stock adjustment).
 *  2. A sale consumes lots oldest-first (FIFO): earliest `receivedAt`, then
 *     earliest `createdAt`, then `id`. Profit for the sale is the sale revenue
 *     minus the *actual* cost of the consumed lots — never `product.buyPrice`.
 *  3. Each consumption is recorded as a `BillItemCostAllocation` so returns and
 *     reports can cost the exact units that left the shelf.
 *  4. Returns restore quantity to the precise lots they came from, in reverse
 *     allocation order (newest consumed lot first), so partial returns are
 *     costed exactly.
 *  5. Purchase returns/voids may only remove units that are still unsold
 *     (a lot's `quantityRemaining`). They never claw back units already sold.
 *
 * These functions perform their Dexie reads/writes against `db.*` directly, so
 * callers MUST run them inside a transaction that already includes
 * `db.inventoryLots` and (for sale/return paths) `db.billItemCostAllocations`.
 * They intentionally do NOT enqueue sync jobs — they return the affected
 * lots/allocations so the calling service can queue sync in the same
 * transaction it owns.
 */

import { db } from '@/lib/db/schema';
import { AppError, AppErrorCode } from '@/lib/errors/app-error';
import { createId } from '@/lib/utils/id';
import { addMoney, multiplyMoney, roundMoney } from '@/lib/utils/money';
import { baseUnitsPerPricingUnit } from '@/lib/utils/weight';
import { isMiscLine } from '@/lib/utils/misc-items';
import type {
  BillItemCostAllocation,
  InventoryLot,
  Purchase,
  PurchaseItem,
} from '@/types/domain';

/** Deterministic FIFO ordering: receivedAt asc, then createdAt asc, then id asc. */
function compareFifo(a: InventoryLot, b: InventoryLot): number {
  if (a.receivedAt !== b.receivedAt) return a.receivedAt < b.receivedAt ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Open lots for a product, ordered FIFO. "Open" means `status === 'open'` and
 * `quantityRemaining > 0` — i.e. lots that still have unsold units to consume.
 */
export async function getOpenLotsForProduct(productId: string): Promise<InventoryLot[]> {
  const lots = await db.inventoryLots.where('productId').equals(productId).toArray();
  return lots
    .filter((lot) => lot.status === 'open' && lot.quantityRemaining > 0)
    .sort(compareFifo);
}

/** Sum of unsold units across a product's open lots — the FIFO-available stock. */
export async function getAvailableLotQuantity(productId: string): Promise<number> {
  const lots = await getOpenLotsForProduct(productId);
  return lots.reduce((sum, lot) => sum + lot.quantityRemaining, 0);
}

/**
 * Create one inventory lot per real (non-misc) purchase line. Misc lines are a
 * general cost with no stock, so they get no lot. Returns the created lots so
 * the caller can queue their sync jobs.
 */
export async function createPurchaseLots(input: {
  purchase: Purchase;
  purchaseItems: PurchaseItem[];
  createdAt: string;
}): Promise<InventoryLot[]> {
  const { purchase, purchaseItems, createdAt } = input;
  const lots: InventoryLot[] = purchaseItems
    .filter((item) => !isMiscLine(item) && item.quantityPurchased > 0)
    .map((item) => ({
      id: createId('lot'),
      productId: item.originalProductId,
      sourceType: 'purchase',
      sourceId: purchase.id,
      sourceItemId: item.id,
      sourceLabel: purchase.purchaseNumber,
      receivedAt: createdAt,
      // For weight lines quantityPurchased is grams and unitCostAtPurchase is
      // per kg; baseUnit tells the FIFO COGS math how to reconcile them.
      baseUnit: item.baseUnit ?? 'piece',
      quantityReceived: item.quantityPurchased,
      quantityRemaining: item.quantityPurchased,
      unitCost: item.unitCostAtPurchase,
      status: 'open',
      createdAt,
      updatedAt: createdAt,
      syncStatus: 'pending',
    }));

  if (lots.length > 0) {
    await db.inventoryLots.bulkAdd(lots);
  }
  return lots;
}

/**
 * Allocate `quantity` units of a sale to FIFO lots, recording exact cost
 * allocations and decrementing the consumed lots.
 *
 * Throws PRODUCT_INSUFFICIENT_STOCK if the open lots can't cover the quantity.
 * Returns the created allocations plus the exact total cost and the weighted
 * average unit cost (used for the bill item's `unitBuyPriceAtSale` display).
 */
export async function allocateFifoLotsForSale(input: {
  billId: string;
  billItemId: string;
  productId: string;
  quantity: number;
  createdAt: string;
}): Promise<{
  allocations: BillItemCostAllocation[];
  totalCost: number;
  averageUnitCost: number;
}> {
  const { billId, billItemId, productId, quantity, createdAt } = input;

  const openLots = await getOpenLotsForProduct(productId);
  const available = openLots.reduce((sum, lot) => sum + lot.quantityRemaining, 0);
  if (available < quantity) {
    throw new AppError(AppErrorCode.PRODUCT_INSUFFICIENT_STOCK, { name: productId });
  }

  // Pricing factor (1 for piece lots, 1000 for gram lots). All of a product's
  // lots share the same base unit, so the first open lot is authoritative.
  const factor = baseUnitsPerPricingUnit(openLots[0]?.baseUnit);

  let remaining = quantity;
  let totalCost = 0;
  const allocations: BillItemCostAllocation[] = [];
  const lotUpdates: InventoryLot[] = [];

  for (const lot of openLots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.quantityRemaining);
    // unitCost is per pricing unit (per kg / per piece); `take` is in base
    // units (grams / pieces), so divide by the factor before costing.
    const lineCost = multiplyMoney(lot.unitCost, take / factor);

    allocations.push({
      id: createId('alloc'),
      billId,
      billItemId,
      productId,
      inventoryLotId: lot.id,
      quantity: take,
      quantityReturned: 0,
      unitCost: lot.unitCost,
      lineCost,
      createdAt,
      updatedAt: createdAt,
      syncStatus: 'pending',
    });

    const nextRemaining = lot.quantityRemaining - take;
    lotUpdates.push({
      ...lot,
      quantityRemaining: nextRemaining,
      status: nextRemaining <= 0 ? 'depleted' : 'open',
      updatedAt: createdAt,
      syncStatus: 'pending',
    });

    totalCost = addMoney(totalCost, lineCost);
    remaining -= take;
  }

  await db.billItemCostAllocations.bulkAdd(allocations);
  await db.inventoryLots.bulkPut(lotUpdates);

  const roundedTotal = roundMoney(totalCost);
  // Average cost per PRICING unit (per kg / per piece) so it pairs with the
  // bill item's per-kg/per-piece sell price. pricingQuantity = base ÷ factor.
  const pricingQuantity = quantity / factor;
  const averageUnitCost = pricingQuantity > 0 ? roundMoney(roundedTotal / pricingQuantity) : 0;
  return { allocations, totalCost: roundedTotal, averageUnitCost };
}

/**
 * Restore `quantity` units of a returned bill item back to the exact lots that
 * were consumed, working in reverse allocation order (newest consumed lot
 * first) so partial returns are deterministic and cost-accurate.
 *
 * Returns the touched allocations/lots plus the exact returned cost and its
 * average per-unit value, so the caller can compute returned profit precisely.
 */
export async function restoreAllocationsForReturn(input: {
  billId: string;
  billItemId: string;
  quantity: number;
  updatedAt: string;
}): Promise<{
  updatedAllocations: BillItemCostAllocation[];
  updatedLots: InventoryLot[];
  returnedCost: number;
  averageReturnedUnitCost: number;
}> {
  const { billItemId, quantity, updatedAt } = input;

  const allocations = await db.billItemCostAllocations
    .where('billItemId')
    .equals(billItemId)
    .toArray();

  if (allocations.length === 0) {
    return { updatedAllocations: [], updatedLots: [], returnedCost: 0, averageReturnedUnitCost: 0 };
  }

  const lotIds = Array.from(new Set(allocations.map((a) => a.inventoryLotId)));
  const lotRows = await db.inventoryLots.bulkGet(lotIds);
  const lotById = new Map<string, InventoryLot>();
  for (const lot of lotRows) {
    if (lot) lotById.set(lot.id, lot);
  }

  // Allocation order mirrors lot FIFO order. Restore in reverse so a return
  // peels off the most-recently consumed lot first.
  const ordered = [...allocations].sort((a, b) => {
    const la = lotById.get(a.inventoryLotId);
    const lb = lotById.get(b.inventoryLotId);
    if (la && lb) return compareFifo(la, lb);
    return 0;
  });

  let remaining = quantity;
  let returnedCost = 0;
  const updatedAllocations: BillItemCostAllocation[] = [];
  const updatedLotsMap = new Map<string, InventoryLot>();

  for (const alloc of ordered.reverse()) {
    if (remaining <= 0) break;
    const alreadyReturned = alloc.quantityReturned ?? 0;
    const returnable = alloc.quantity - alreadyReturned;
    if (returnable <= 0) continue;

    const take = Math.min(remaining, returnable);
    updatedAllocations.push({
      ...alloc,
      quantityReturned: alreadyReturned + take,
      updatedAt,
      syncStatus: 'pending',
    });

    const lot = updatedLotsMap.get(alloc.inventoryLotId) ?? lotById.get(alloc.inventoryLotId);
    if (lot) {
      const nextRemaining = lot.quantityRemaining + take;
      updatedLotsMap.set(alloc.inventoryLotId, {
        ...lot,
        quantityRemaining: nextRemaining,
        // A lot that gets units back is sellable again. Never resurrect a
        // 'voided' lot (a sold lot can't have been voided, so this is safe).
        status: lot.status === 'voided' ? 'voided' : nextRemaining > 0 ? 'open' : lot.status,
        updatedAt,
        syncStatus: 'pending',
      });
    }

    // unitCost is per pricing unit; `take` is in base units, so divide by the
    // lot's factor before costing the returned quantity.
    const factor = baseUnitsPerPricingUnit(lot?.baseUnit);
    returnedCost = addMoney(returnedCost, multiplyMoney(alloc.unitCost, take / factor));
    remaining -= take;
  }

  const updatedLots = Array.from(updatedLotsMap.values());
  if (updatedAllocations.length > 0) await db.billItemCostAllocations.bulkPut(updatedAllocations);
  if (updatedLots.length > 0) await db.inventoryLots.bulkPut(updatedLots);

  const restoredBaseQty = quantity - remaining;
  const roundedCost = roundMoney(returnedCost);
  // Average per PRICING unit. All restored lots share one base unit, so derive
  // the factor from the first updated lot.
  const factor = baseUnitsPerPricingUnit(updatedLots[0]?.baseUnit);
  const restoredPricingQty = restoredBaseQty / factor;
  const averageReturnedUnitCost = restoredPricingQty > 0 ? roundMoney(roundedCost / restoredPricingQty) : 0;
  return { updatedAllocations, updatedLots, returnedCost: roundedCost, averageReturnedUnitCost };
}

/**
 * Remove up to `quantity` *unsold* units from the lot(s) created by a purchase
 * item — used by purchase return and purchase void.
 *
 * Only `quantityRemaining` (units not yet sold) may be removed. If the request
 * exceeds the unsold quantity it throws `errorCode` (the caller passes the
 * return- or void-specific code) and nothing is mutated, so already-sold units
 * can never be clawed back. A lot fully removed before any sale is marked
 * `voided` (history preserved, not deleted); a partial removal decrements both
 * received and remaining counts.
 */
export async function removePurchaseLotQuantity(input: {
  purchaseItemId: string;
  quantity: number;
  updatedAt: string;
  errorCode?: AppErrorCode;
}): Promise<InventoryLot[]> {
  const { purchaseItemId, quantity, updatedAt } = input;
  const errorCode = input.errorCode ?? AppErrorCode.PURCHASE_RETURN_INSUFFICIENT_STOCK;

  const lots = (await db.inventoryLots.where('sourceItemId').equals(purchaseItemId).toArray())
    .filter((lot) => lot.sourceType === 'purchase' && lot.status !== 'voided')
    .sort(compareFifo);

  const availableUnsold = lots.reduce((sum, lot) => sum + lot.quantityRemaining, 0);
  if (quantity > availableUnsold) {
    // Some units were already sold (or the lot is gone) — refuse to remove them.
    throw new AppError(errorCode);
  }

  let remaining = quantity;
  const updated: InventoryLot[] = [];
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.quantityRemaining);
    const nextReceived = lot.quantityReceived - take;
    const nextRemaining = lot.quantityRemaining - take;
    const fullyRemoved = nextReceived <= 0;
    updated.push({
      ...lot,
      quantityReceived: Math.max(0, nextReceived),
      quantityRemaining: Math.max(0, nextRemaining),
      status: fullyRemoved ? 'voided' : nextRemaining <= 0 ? 'depleted' : 'open',
      updatedAt,
      syncStatus: 'pending',
    });
    remaining -= take;
  }

  if (updated.length > 0) await db.inventoryLots.bulkPut(updated);
  return updated;
}

/** Create a lot for a positive stock adjustment (manual receive / count up). */
export async function createAdjustmentLot(input: {
  productId: string;
  quantity: number;
  unitCost: number;
  sourceId: string;
  sourceLabel?: string;
  baseUnit?: InventoryLot['baseUnit'];
  createdAt: string;
}): Promise<InventoryLot> {
  const { productId, quantity, unitCost, sourceId, sourceLabel, baseUnit, createdAt } = input;
  const lot: InventoryLot = {
    id: createId('lot'),
    productId,
    sourceType: 'stock_adjustment',
    sourceId,
    sourceLabel,
    // grams for weight products (unitCost is then per kg), pieces otherwise.
    baseUnit: baseUnit ?? 'piece',
    receivedAt: createdAt,
    quantityReceived: quantity,
    quantityRemaining: quantity,
    unitCost: Number.isFinite(unitCost) && unitCost >= 0 ? unitCost : 0,
    status: 'open',
    createdAt,
    updatedAt: createdAt,
    syncStatus: 'pending',
  };
  await db.inventoryLots.add(lot);
  return lot;
}

/**
 * Consume `quantity` units FIFO without producing a bill allocation — used when
 * a stock adjustment / count *decreases* stock. Throws
 * INVENTORY_LOT_INSUFFICIENT_STOCK if open lots can't cover it.
 */
export async function consumeLotsForNegativeAdjustment(input: {
  productId: string;
  quantity: number;
  updatedAt: string;
}): Promise<InventoryLot[]> {
  const { productId, quantity, updatedAt } = input;
  const openLots = await getOpenLotsForProduct(productId);
  const available = openLots.reduce((sum, lot) => sum + lot.quantityRemaining, 0);
  if (available < quantity) {
    throw new AppError(AppErrorCode.INVENTORY_LOT_INSUFFICIENT_STOCK, { name: productId });
  }

  let remaining = quantity;
  const updated: InventoryLot[] = [];
  for (const lot of openLots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.quantityRemaining);
    const nextRemaining = lot.quantityRemaining - take;
    updated.push({
      ...lot,
      quantityRemaining: nextRemaining,
      status: nextRemaining <= 0 ? 'depleted' : 'open',
      updatedAt,
      syncStatus: 'pending',
    });
    remaining -= take;
  }

  if (updated.length > 0) await db.inventoryLots.bulkPut(updated);
  return updated;
}

/**
 * Current inventory cost value from lots: sum(quantityRemaining * unitCost)
 * across all non-voided lots. This is the accurate replacement for the old
 * `quantityInStock * buyPrice`, which over/under-valued stock whenever the
 * latest buy price differed from older remaining lots.
 */
export async function calculateInventoryCostValue(): Promise<number> {
  const lots = await db.inventoryLots.toArray();
  let total = 0;
  for (const lot of lots) {
    if (lot.status === 'voided' || lot.quantityRemaining <= 0) continue;
    // quantityRemaining is base units; unitCost is per pricing unit.
    const factor = baseUnitsPerPricingUnit(lot.baseUnit);
    total = addMoney(total, multiplyMoney(lot.unitCost, lot.quantityRemaining / factor));
  }
  return roundMoney(total);
}

/**
 * Dev/test invariant: a product's cached `quantityInStock` must equal the sum
 * of its open-lot remaining quantities. Throws if they diverge.
 */
export async function assertProductStockMatchesLots(productId: string): Promise<void> {
  const product = await db.products.get(productId);
  if (!product) return;
  const available = await getAvailableLotQuantity(productId);
  if (product.quantityInStock !== available) {
    throw new Error(
      `Stock/lot mismatch for product ${productId}: quantityInStock=${product.quantityInStock} but open lots sum to ${available}`,
    );
  }
}

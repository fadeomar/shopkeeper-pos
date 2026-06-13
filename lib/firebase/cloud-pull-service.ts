import { collection, getDocs } from 'firebase/firestore';
import { firestore } from '@/lib/firebase/config';
import { db } from '@/lib/db/schema';
import { saveConflict } from '@/lib/services/sync-conflict-service';
import { buildSyncQueueItem, getSyncQueueId } from '@/lib/services/sync-queue-service';
import {
  SETTINGS_TRACKED_FIELDS,
  finiteSequence,
  isSettingsSequenceField,
  mergedSequences,
} from '@/lib/services/settings-sync-fields';
import { normalizeBillSplit } from '@/lib/utils/bill-split';
import type { AuditEvent, Bill, BillItem, BillItemCostAllocation, CashMovement, Customer, CustomerPayment, Expense, InventoryLot, Product, Purchase, PurchaseItem, Settings, Shift, StockMovement, Supplier, SupplierPayment, SyncEntity, SyncQueueItem } from '@/types/domain';

const PRODUCT_FIELDS: Array<keyof Product> = [
  'barcode', 'name', 'category', 'brand', 'unit', 'quantityInStock', 'buyPrice', 'sellPrice',
  'minimumStockAlert', 'supplierName', 'expiryDate', 'shelfLocation', 'notes', 'status',
];
function valuesDiffer(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

function changedFields<T extends Record<string, unknown>>(local: T, cloud: T, fields: string[]): string[] {
  return fields.filter((field) => valuesDiffer(local[field], cloud[field]));
}

function isCloudNewer(localSyncedAt?: string, cloudSyncedAt?: string): boolean {
  if (!cloudSyncedAt) return false;
  if (!localSyncedAt) return true;
  return new Date(cloudSyncedAt).getTime() > new Date(localSyncedAt).getTime();
}

function laterIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (!Number.isFinite(aTime)) return b;
  if (!Number.isFinite(bTime)) return a;
  return bTime > aTime ? b : a;
}

/**
 * Pulls a Firestore subcollection and guarantees every returned row has an
 * `id` field set to the Firestore document ID.
 *
 * Older devices wrote the entity's id INTO the document body, but newer
 * devices (and any record reconstructed from a partial migration) may not.
 * Without this fallback, `docSnap.data().id` is undefined and Dexie's primary
 * key write either rejects the row or — worse — silently writes multiple
 * "id: undefined" rows that collide and overwrite each other. That's why
 * an existing cloud account can sign in and see nothing land locally.
 *
 * Mirror of `withDocId` in restore-service.ts so both paths produce
 * identically-shaped rows.
 */
async function pullCollection<T extends { id?: string }>(
  uid: string,
  name: string,
): Promise<Array<T & { id: string }>> {
  const snap = await getDocs(collection(firestore, `users/${uid}/${name}`));
  return snap.docs.map((docSnap) => {
    const data = docSnap.data() as T;
    return {
      ...data,
      id: typeof data.id === 'string' && data.id.trim() ? data.id : docSnap.id,
    } as T & { id: string };
  });
}

function isActiveLocalJob(job: SyncQueueItem | undefined): job is SyncQueueItem {
  return Boolean(job && ['pending', 'failed', 'syncing', 'conflict', 'blocked'].includes(job.status));
}

async function getPendingLocalJob(entity: SyncEntity, entityId: string): Promise<SyncQueueItem | undefined> {
  const job = await db.syncQueue.get(getSyncQueueId(entity, entityId));
  return isActiveLocalJob(job) ? job : undefined;
}

async function pullProducts(uid: string): Promise<void> {
  const cloudProducts = await pullCollection<Product>(uid, 'products');
  for (const cloud of cloudProducts) {
    const local = await db.products.get(cloud.id);
    if (!local) {
      await db.products.put({ ...cloud, syncStatus: 'synced', lastSyncError: undefined });
      continue;
    }

    const pendingJob = await getPendingLocalJob('product', local.id);
    const fields = changedFields(
      local as unknown as Record<string, unknown>,
      cloud as unknown as Record<string, unknown>,
      PRODUCT_FIELDS as string[],
    );
    if (fields.length === 0 || !isCloudNewer(local.syncedAt ?? pendingJob?.createdAt, cloud.syncedAt)) continue;

    if (pendingJob) {
      const conflictId = await saveConflict({
        id: `conflict:product:${local.id}:pull-cloud`,
        entity: 'product',
        entityId: local.id,
        operationId: getSyncQueueId('product', local.id),
        conflictType: fields.includes('quantityInStock') ? 'inventory_overwrite' : 'same_field_changed',
        severity: fields.includes('quantityInStock') ? 'high' : 'medium',
        cloudRecord: cloud as unknown as Record<string, unknown>,
        localRecord: local as unknown as Record<string, unknown>,
        changedFields: fields,
      });
      if (conflictId) {
        await db.products.update(local.id, { syncStatus: 'conflict', lastSyncError: 'Needs conflict review' });
        await db.syncQueue.update(getSyncQueueId('product', local.id), { status: 'conflict', lastError: 'Needs conflict review' });
      }
      continue;
    }

    await db.products.put({ ...cloud, syncStatus: 'synced', lastSyncError: undefined });
  }
}

async function pullSettings(uid: string): Promise<void> {
  const cloudSettings = await pullCollection<Settings>(uid, 'settings');
  for (const cloud of cloudSettings) {
    const local = await db.settings.get(cloud.id);
    if (!local) {
      await db.settings.put({ ...cloud, syncStatus: 'synced', lastSyncError: undefined });
      continue;
    }

    const pendingJob = await getPendingLocalJob('settings', local.id);
    const fields = changedFields(
      local as unknown as Record<string, unknown>,
      cloud as unknown as Record<string, unknown>,
      SETTINGS_TRACKED_FIELDS,
    );
    if (fields.length === 0 || !isCloudNewer(local.syncedAt ?? pendingJob?.createdAt, cloud.syncedAt)) continue;

    const businessFields = fields.filter((field) => !isSettingsSequenceField(field));
    if (businessFields.length === 0) {
      // Only monotonic counters differ — max-merge both bill + purchase
      // sequences. If this device is ahead on either, push the merged value
      // up; otherwise accept the cloud copy with the maxed counters.
      const sequences = mergedSequences(local, cloud);
      const localAhead =
        sequences.nextBillSequence > finiteSequence(cloud.nextBillSequence) ||
        sequences.nextPurchaseSequence > finiteSequence(cloud.nextPurchaseSequence);
      if (localAhead) {
        const merged = {
          ...local,
          ...sequences,
          updatedAt: laterIso(local.updatedAt, cloud.updatedAt) ?? local.updatedAt,
          syncStatus: 'pending' as const,
          lastSyncError: undefined,
        };
        const existingJob = await db.syncQueue.get(getSyncQueueId('settings', local.id));
        await db.settings.put(merged);
        await db.syncQueue.put(buildSyncQueueItem(
          { entity: 'settings', entityId: local.id, operation: 'upsert' },
          existingJob,
        ));
      } else {
        await db.settings.put({ ...cloud, ...sequences, syncStatus: 'synced', lastSyncError: undefined });
      }
      continue;
    }

    if (pendingJob) {
      const conflictId = await saveConflict({
        id: `conflict:settings:${local.id}:pull-cloud`,
        entity: 'settings',
        entityId: local.id,
        operationId: getSyncQueueId('settings', local.id),
        conflictType: 'settings_conflict',
        severity: businessFields.some((field) => ['currency'].includes(field)) ? 'critical' : 'high',
        cloudRecord: cloud as unknown as Record<string, unknown>,
        localRecord: local as unknown as Record<string, unknown>,
        changedFields: fields,
      });
      if (conflictId) {
        await db.settings.update(local.id, { syncStatus: 'conflict', lastSyncError: 'Needs conflict review' });
        await db.syncQueue.update(getSyncQueueId('settings', local.id), { status: 'conflict', lastError: 'Needs conflict review' });
      }
      continue;
    }

    await db.settings.put({ ...cloud, syncStatus: 'synced', lastSyncError: undefined });
  }
}

async function pullAppendOnlyCollections(uid: string): Promise<void> {
  const [bills, billItems, movements, payments, purchases, purchaseItems, supplierPayments] = await Promise.all([
    pullCollection<Bill>(uid, 'bills'),
    pullCollection<BillItem>(uid, 'billItems'),
    pullCollection<StockMovement>(uid, 'stockMovements'),
    pullCollection<CustomerPayment>(uid, 'customerPayments'),
    pullCollection<Purchase>(uid, 'purchases'),
    pullCollection<PurchaseItem>(uid, 'purchaseItems'),
    pullCollection<SupplierPayment>(uid, 'supplierPayments'),
  ]);

  // Bills look append-only at create time, but voidBill() and returnBillItem()
  // mutate status, returnedAmount, quantityReturned etc. on the original
  // record. A device that already has the bill ID locally was being skipped
  // here, so voids/returns from another device never propagated. Pull updates
  // when cloud is newer and we have no active local job for that bill (an
  // active job means this device made its own offline change and the next
  // push will reconcile it).
  // db.syncQueue is read inside via getPendingLocalJob; Dexie requires it
  // in the transaction tables list or it throws a scope error in strict
  // transactional mode.
  await db.transaction('rw', [db.bills, db.billItems, db.stockMovements, db.customerPayments, db.purchases, db.purchaseItems, db.supplierPayments, db.syncQueue], async () => {
    for (const bill of bills) {
      // Bills authored by a pre-v6 device lack cashAmount/cardAmount/creditAmount.
      // Fill them in once on the way into local storage so every reader downstream
      // can rely on the split being present.
      const normalized = normalizeBillSplit(bill) as Bill;
      const local = await db.bills.get(normalized.id);
      if (!local) {
        await db.bills.put({ ...normalized, syncStatus: 'synced', lastSyncError: undefined });
        continue;
      }
      const billJob = await getPendingLocalJob('bill', normalized.id);
      if (billJob) continue;
      if (!isCloudNewer(local.syncedAt, normalized.syncedAt)) continue;
      await db.bills.put({ ...normalized, syncStatus: 'synced', lastSyncError: undefined });
    }

    for (const item of billItems) {
      const local = await db.billItems.get(item.id);
      if (!local) {
        await db.billItems.put(item);
        continue;
      }
      // Bill items are otherwise immutable snapshots; quantityReturned is the
      // only field that changes after creation. If the parent bill has an
      // active local job, leave items alone until that push reconciles.
      const parentJob = await getPendingLocalJob('bill', item.billId);
      if (parentJob) continue;
      const localReturned = local.quantityReturned ?? 0;
      const cloudReturned = item.quantityReturned ?? 0;
      if (cloudReturned === localReturned) continue;
      await db.billItems.update(item.id, { quantityReturned: cloudReturned });
    }

    // Stock movements are truly append-only — they record discrete events and
    // never mutate. Customer payments likewise have no update path today.
    for (const movement of movements) if (!(await db.stockMovements.get(movement.id))) await db.stockMovements.put({ ...movement, syncStatus: 'synced', lastSyncError: undefined });
    for (const payment of payments) if (!(await db.customerPayments.get(payment.id))) await db.customerPayments.put({ ...payment, syncStatus: 'synced', lastSyncError: undefined });

    // Purchases mirror bills exactly: append-only at create time, mutable on
    // void/return. Same pending-job guard, same isCloudNewer check.
    // Purchases share the bill payment-split invariant, so normalizeBillSplit
    // fills in any pre-v9 documents that lack cashAmount/cardAmount/creditAmount.
    for (const purchase of purchases) {
      const normalized = normalizeBillSplit(purchase as unknown as Bill) as unknown as Purchase;
      const local = await db.purchases.get(normalized.id);
      if (!local) {
        await db.purchases.put({ ...normalized, syncStatus: 'synced', lastSyncError: undefined });
        continue;
      }
      const purchaseJob = await getPendingLocalJob('purchase', normalized.id);
      if (purchaseJob) continue;
      if (!isCloudNewer(local.syncedAt, normalized.syncedAt)) continue;
      await db.purchases.put({ ...normalized, syncStatus: 'synced', lastSyncError: undefined });
    }

    // Purchase items mirror bill items: immutable except for quantityReturned.
    for (const item of purchaseItems) {
      const local = await db.purchaseItems.get(item.id);
      if (!local) {
        await db.purchaseItems.put(item);
        continue;
      }
      const parentJob = await getPendingLocalJob('purchase', item.purchaseId);
      if (parentJob) continue;
      const localReturned = local.quantityReturned ?? 0;
      const cloudReturned = item.quantityReturned ?? 0;
      if (cloudReturned === localReturned) continue;
      await db.purchaseItems.update(item.id, { quantityReturned: cloudReturned });
    }

    // Supplier payments are append-only, mirror of customerPayments.
    for (const payment of supplierPayments) if (!(await db.supplierPayments.get(payment.id))) await db.supplierPayments.put({ ...payment, syncStatus: 'synced', lastSyncError: undefined });
  });
}

async function pullCustomers(uid: string): Promise<void> {
  const cloudCustomers = await pullCollection<Customer>(uid, 'customers');
  if (cloudCustomers.length === 0) return;

  // db.syncQueue is read inside via getPendingLocalJob — include it in the
  // transaction scope.
  await db.transaction('rw', [db.customers, db.syncQueue], async () => {
    for (const cloud of cloudCustomers) {
      const local = await db.customers.get(cloud.id);
      if (!local) {
        await db.customers.put({ ...cloud, syncStatus: 'synced', lastSyncError: undefined });
        continue;
      }
      // Skip if local has an unsynced edit — that push will reconcile it.
      const pendingJob = await getPendingLocalJob('customer', local.id);
      if (pendingJob) continue;
      if (!isCloudNewer(local.syncedAt, cloud.syncedAt)) continue;
      await db.customers.put({ ...cloud, syncStatus: 'synced', lastSyncError: undefined });
    }
  });
}

async function pullSuppliers(uid: string): Promise<void> {
  const cloudSuppliers = await pullCollection<Supplier>(uid, 'suppliers');
  if (cloudSuppliers.length === 0) return;

  await db.transaction('rw', [db.suppliers, db.syncQueue], async () => {
    for (const cloud of cloudSuppliers) {
      const local = await db.suppliers.get(cloud.id);
      if (!local) {
        await db.suppliers.put({ ...cloud, syncStatus: 'synced', lastSyncError: undefined });
        continue;
      }
      const pendingJob = await getPendingLocalJob('supplier', local.id);
      if (pendingJob) continue;
      if (!isCloudNewer(local.syncedAt, cloud.syncedAt)) continue;
      await db.suppliers.put({ ...cloud, syncStatus: 'synced', lastSyncError: undefined });
    }
  });
}

async function pullShifts(uid: string): Promise<void> {
  const cloudShifts = await pullCollection<Shift>(uid, 'shifts');
  if (cloudShifts.length === 0) return;

  await db.transaction('rw', [db.shifts, db.syncQueue], async () => {
    for (const cloud of cloudShifts) {
      const local = await db.shifts.get(cloud.id);
      if (!local) {
        await db.shifts.put({ ...cloud, syncStatus: 'synced', lastSyncError: undefined });
        continue;
      }
      // Skip if this device has unsynced edits to the shift — the push path
      // will reconcile. Otherwise pull the newer cloud version.
      const pendingJob = await getPendingLocalJob('shift', local.id);
      if (pendingJob) continue;
      if (!isCloudNewer(local.syncedAt, cloud.syncedAt)) continue;
      await db.shifts.put({ ...cloud, syncStatus: 'synced', lastSyncError: undefined });
    }
  });
}

const INVENTORY_LOT_FIELDS: Array<keyof InventoryLot> = [
  'quantityReceived', 'quantityRemaining', 'unitCost', 'status',
];

/**
 * Pull FIFO inventory lots. Lots ARE mutable (every sale/return/void changes
 * quantityRemaining + status), so this needs the same conflict guard products
 * use: if the cloud lot is newer AND this device has a pending change to the
 * same lot, raise an inventory conflict instead of silently overwriting one
 * device's view of remaining stock (the offline-oversell case). Mirrors
 * pullProducts — deliberately NOT wrapped in a Dexie transaction because
 * saveConflict opens its own.
 */
async function pullInventoryLots(uid: string): Promise<void> {
  const cloudLots = await pullCollection<InventoryLot>(uid, 'inventoryLots');
  for (const cloud of cloudLots) {
    const local = await db.inventoryLots.get(cloud.id);
    if (!local) {
      await db.inventoryLots.put({ ...cloud, syncStatus: 'synced', lastSyncError: undefined });
      continue;
    }

    const pendingJob = await getPendingLocalJob('inventoryLot', local.id);
    const fields = changedFields(
      local as unknown as Record<string, unknown>,
      cloud as unknown as Record<string, unknown>,
      INVENTORY_LOT_FIELDS as string[],
    );
    if (fields.length === 0 || !isCloudNewer(local.syncedAt ?? pendingJob?.createdAt, cloud.syncedAt)) continue;

    if (pendingJob) {
      const conflictId = await saveConflict({
        id: `conflict:inventoryLot:${local.id}:pull-cloud`,
        entity: 'inventoryLot',
        entityId: local.id,
        operationId: getSyncQueueId('inventoryLot', local.id),
        conflictType: 'inventory_overwrite',
        severity: 'high',
        cloudRecord: cloud as unknown as Record<string, unknown>,
        localRecord: local as unknown as Record<string, unknown>,
        changedFields: fields,
      });
      if (conflictId) {
        await db.inventoryLots.update(local.id, { syncStatus: 'conflict', lastSyncError: 'Needs conflict review' });
        await db.syncQueue.update(getSyncQueueId('inventoryLot', local.id), { status: 'conflict', lastError: 'Needs conflict review' });
      }
      continue;
    }

    await db.inventoryLots.put({ ...cloud, syncStatus: 'synced', lastSyncError: undefined });
  }
}

/**
 * Pull bill-item cost allocations. They change only via the parent bill's
 * return/void (quantityReturned), so mirror billItems: insert if missing, and
 * otherwise accept a newer cloud copy unless this device has a pending change
 * to the allocation or its parent bill (that push will reconcile).
 */
async function pullBillItemCostAllocations(uid: string): Promise<void> {
  const cloudAllocations = await pullCollection<BillItemCostAllocation>(uid, 'billItemCostAllocations');
  if (cloudAllocations.length === 0) return;

  await db.transaction('rw', [db.billItemCostAllocations, db.syncQueue], async () => {
    for (const cloud of cloudAllocations) {
      const local = await db.billItemCostAllocations.get(cloud.id);
      if (!local) {
        await db.billItemCostAllocations.put({ ...cloud, syncStatus: 'synced', lastSyncError: undefined });
        continue;
      }
      const parentJob = await getPendingLocalJob('bill', cloud.billId);
      const ownJob = await getPendingLocalJob('billItemCostAllocation', cloud.id);
      if (parentJob || ownJob) continue;
      if (!isCloudNewer(local.syncedAt, cloud.syncedAt)) continue;
      await db.billItemCostAllocations.put({ ...cloud, syncStatus: 'synced', lastSyncError: undefined });
    }
  });
}

/**
 * Pull append-only history tables that have no merge conflicts and no
 * pending-job interactions: each cloud row is either already local (skip)
 * or new (insert). Used for audit events, cash movements, and expenses.
 */
async function pullSimpleAppendOnly<
  TName extends 'auditEvents' | 'cashMovements' | 'expenses',
  TRow extends { id: string } & Record<string, unknown>,
>(uid: string, name: TName, table: { get(id: string): Promise<TRow | undefined>; put(row: TRow): Promise<unknown> }): Promise<void> {
  const cloudRows = await pullCollection<TRow>(uid, name);
  for (const row of cloudRows) {
    const local = await table.get(row.id);
    if (local) continue;
    await table.put({ ...row, syncStatus: 'synced', lastSyncError: undefined } as TRow);
  }
}

export async function pullCloudChangesBeforePush(uid: string): Promise<void> {
  await pullAppendOnlyCollections(uid);
  await pullCustomers(uid);
  await pullSuppliers(uid);
  await pullShifts(uid);
  await pullProducts(uid);
  // FIFO records: lots after products (parent first), allocations after bills
  // (pulled in pullAppendOnlyCollections above).
  await pullInventoryLots(uid);
  await pullBillItemCostAllocations(uid);
  await pullSettings(uid);
  // History-only tables added in sprint v12–v14. Append-only and never
  // mutated after creation, so a simple "insert if missing" loop is enough —
  // no conflict detection or pending-job interaction needed.
  await pullSimpleAppendOnly<'auditEvents', AuditEvent & Record<string, unknown>>(uid, 'auditEvents', db.auditEvents as unknown as { get(id: string): Promise<(AuditEvent & Record<string, unknown>) | undefined>; put(row: AuditEvent & Record<string, unknown>): Promise<unknown> });
  await pullSimpleAppendOnly<'cashMovements', CashMovement & Record<string, unknown>>(uid, 'cashMovements', db.cashMovements as unknown as { get(id: string): Promise<(CashMovement & Record<string, unknown>) | undefined>; put(row: CashMovement & Record<string, unknown>): Promise<unknown> });
  await pullSimpleAppendOnly<'expenses', Expense & Record<string, unknown>>(uid, 'expenses', db.expenses as unknown as { get(id: string): Promise<(Expense & Record<string, unknown>) | undefined>; put(row: Expense & Record<string, unknown>): Promise<unknown> });
}

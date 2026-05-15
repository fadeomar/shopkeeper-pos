import { collection, getDocs } from 'firebase/firestore';
import { firestore } from '@/lib/firebase/config';
import { db } from '@/lib/db/schema';
import { saveConflict } from '@/lib/services/sync-conflict-service';
import { buildSyncQueueItem, getSyncQueueId } from '@/lib/services/sync-queue-service';
import { normalizeBillSplit } from '@/lib/utils/bill-split';
import type { Bill, BillItem, Customer, CustomerPayment, Product, Settings, Shift, StockMovement, SyncEntity, SyncQueueItem } from '@/types/domain';

const PRODUCT_FIELDS: Array<keyof Product> = [
  'barcode', 'name', 'category', 'brand', 'unit', 'quantityInStock', 'buyPrice', 'sellPrice',
  'minimumStockAlert', 'supplierName', 'expiryDate', 'shelfLocation', 'notes', 'status',
];
const SETTINGS_FIELDS: Array<keyof Settings> = [
  'storeName', 'cashierName', 'currency', 'allowLossSale', 'nextBillSequence', 'lowStockHighlight',
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

function finiteSequence(value: unknown, fallback = 1): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
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

async function pullCollection<T>(uid: string, name: string): Promise<T[]> {
  const snap = await getDocs(collection(firestore, `users/${uid}/${name}`));
  return snap.docs.map((docSnap) => docSnap.data() as T);
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
      SETTINGS_FIELDS as string[],
    );
    if (fields.length === 0 || !isCloudNewer(local.syncedAt ?? pendingJob?.createdAt, cloud.syncedAt)) continue;

    const businessFields = fields.filter((field) => field !== 'nextBillSequence');
    if (businessFields.length === 0) {
      const nextBillSequence = Math.max(
        finiteSequence(local.nextBillSequence),
        finiteSequence(cloud.nextBillSequence),
      );
      if (nextBillSequence > finiteSequence(cloud.nextBillSequence)) {
        const merged = {
          ...local,
          nextBillSequence,
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
        await db.settings.put({ ...cloud, nextBillSequence, syncStatus: 'synced', lastSyncError: undefined });
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
  const [bills, billItems, movements, payments] = await Promise.all([
    pullCollection<Bill>(uid, 'bills'),
    pullCollection<BillItem>(uid, 'billItems'),
    pullCollection<StockMovement>(uid, 'stockMovements'),
    pullCollection<CustomerPayment>(uid, 'customerPayments'),
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
  await db.transaction('rw', [db.bills, db.billItems, db.stockMovements, db.customerPayments, db.syncQueue], async () => {
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

export async function pullCloudChangesBeforePush(uid: string): Promise<void> {
  await pullAppendOnlyCollections(uid);
  await pullCustomers(uid);
  await pullShifts(uid);
  await pullProducts(uid);
  await pullSettings(uid);
}

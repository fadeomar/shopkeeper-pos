import { writeBatch, doc, getDoc, setDoc, runTransaction } from 'firebase/firestore';
import { firestore } from './config';
import { db } from '@/lib/db/schema';
import { nowIso } from '@/lib/utils/date';
import { detectProductCloudConflict, detectSettingsCloudConflict } from '@/lib/firebase/cloud-merge-service';
import type { Bill, BillItem, Product, Settings, StockMovement, CustomerPayment, SyncQueueItem } from '@/types/domain';

const BATCH_SIZE = 400; // Firestore max is 500; stay under

export interface SyncMeta {
  lastSyncedAt: string;
  recordCounts: {
    bills: number;
    billItems: number;
    products: number;
    stockMovements: number;
    customerPayments?: number;
  };
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T;
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) output[key] = stripUndefined(item);
    }
    return output as T;
  }
  return value;
}

function asSyncedRecord<T extends { syncStatus?: string; syncedAt?: string; lastSyncError?: string }>(
  record: T,
  syncedAt: string,
): T {
  return stripUndefined({
    ...record,
    syncStatus: 'synced',
    syncedAt,
    lastSyncError: undefined,
  }) as T;
}

function numberOrZero(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function newestIso(...values: Array<string | undefined>): string {
  const valid = values.filter((value): value is string => Boolean(value));
  if (valid.length === 0) return nowIso();
  return valid.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

function appliedMovementIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set<string>();
  return new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0));
}

async function commitInBatches(
  writes: Array<{ ref: ReturnType<typeof doc>; data: object }>,
): Promise<void> {
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = writeBatch(firestore);
    writes.slice(i, i + BATCH_SIZE).forEach(({ ref, data }) => batch.set(ref, stripUndefined(data)));
    await batch.commit();
  }
}

async function mergeSettingsSequenceFromCloud(uid: string, settings: Settings): Promise<Settings> {
  try {
    const snap = await getDoc(doc(firestore, `users/${uid}/settings/${settings.id}`));
    if (!snap.exists()) return settings;
    const cloud = snap.data() as Settings;
    return {
      ...settings,
      nextBillSequence: Math.max(settings.nextBillSequence || 1, cloud.nextBillSequence || 1),
    };
  } catch {
    return settings;
  }
}

export async function syncBillToCloud(
  uid: string,
  bill: Bill,
  items: BillItem[],
  movements: StockMovement[] = [],
): Promise<string> {
  const syncedAt = nowIso();
  const writes = [
    { ref: doc(firestore, `users/${uid}/bills/${bill.id}`), data: asSyncedRecord(bill, syncedAt) },
    ...items.map((item) => ({
      ref: doc(firestore, `users/${uid}/billItems/${item.id}`),
      data: stripUndefined(item),
    })),
    ...movements.map((movement) => ({
      ref: doc(firestore, `users/${uid}/stockMovements/${movement.id}`),
      data: asSyncedRecord(movement, syncedAt),
    })),
  ];
  await commitInBatches(writes);
  return syncedAt;
}

/**
 * Apply bill/return stock movements to cloud products as idempotent deltas.
 * This prevents an offline sale from overwriting product names, prices, or other
 * fields that may have changed in the cloud while this device was offline.
 */
export async function applyStockMovementDeltasToCloudProducts(
  uid: string,
  products: Product[],
  movements: StockMovement[],
): Promise<{ syncedAt: string; products: Product[] }> {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const movementsByProduct = new Map<string, StockMovement[]>();
  for (const movement of movements) {
    if (!movement.productId) continue;
    const list = movementsByProduct.get(movement.productId) ?? [];
    list.push(movement);
    movementsByProduct.set(movement.productId, list);
  }

  const syncedAt = nowIso();
  const syncedProducts: Product[] = [];

  for (const [productId, productMovements] of movementsByProduct) {
    const localProduct = productsById.get(productId);
    if (!localProduct) continue;

    const productRef = doc(firestore, `users/${uid}/products/${productId}`);
    const nextProduct = await runTransaction(firestore, async (transaction) => {
      const cloudSnap = await transaction.get(productRef);
      const cloudProduct = cloudSnap.exists()
        ? (cloudSnap.data() as Product & { appliedStockMovementIds?: unknown })
        : null;
      const appliedIds = appliedMovementIds(cloudProduct?.appliedStockMovementIds);
      const unappliedMovements = productMovements.filter((movement) => !appliedIds.has(movement.id));
      const delta = unappliedMovements.reduce((sum, movement) => sum + numberOrZero(movement.quantityChange), 0);
      const nextAppliedIds = Array.from(new Set([
        ...Array.from(appliedIds),
        ...unappliedMovements.map((movement) => movement.id),
      ])).slice(-1000);

      const record = cloudProduct
        ? {
            ...cloudProduct,
            quantityInStock: numberOrZero(cloudProduct.quantityInStock) + delta,
            lastUpdated: newestIso(cloudProduct.lastUpdated, localProduct.lastUpdated, syncedAt),
            syncStatus: 'synced',
            syncedAt,
            lastSyncError: undefined,
            appliedStockMovementIds: nextAppliedIds,
          }
        : {
            ...asSyncedRecord(localProduct, syncedAt),
            appliedStockMovementIds: nextAppliedIds,
          };

      transaction.set(productRef, stripUndefined(record));
      return record as Product;
    });

    syncedProducts.push(nextProduct);
  }

  return { syncedAt, products: syncedProducts };
}

export async function syncProductsToCloud(
  uid: string,
  products: Product[],
): Promise<string | null> {
  if (products.length === 0) return null;
  const syncedAt = nowIso();
  const writes = products.map((p) => ({
    ref: doc(firestore, `users/${uid}/products/${p.id}`),
    data: asSyncedRecord(p, syncedAt),
  }));
  await commitInBatches(writes);
  return syncedAt;
}

export async function syncStockMovementsToCloud(
  uid: string,
  movements: StockMovement[],
): Promise<string | null> {
  if (movements.length === 0) return null;
  const syncedAt = nowIso();
  const writes = movements.map((movement) => ({
    ref: doc(firestore, `users/${uid}/stockMovements/${movement.id}`),
    data: asSyncedRecord(movement, syncedAt),
  }));
  await commitInBatches(writes);
  return syncedAt;
}

export async function syncCustomerPaymentsToCloud(
  uid: string,
  payments: CustomerPayment[],
): Promise<string | null> {
  if (payments.length === 0) return null;
  const syncedAt = nowIso();
  const writes = payments.map((payment) => ({
    ref: doc(firestore, `users/${uid}/customerPayments/${payment.id}`),
    data: asSyncedRecord(payment, syncedAt),
  }));
  await commitInBatches(writes);
  return syncedAt;
}

/** Push a single settings document to Firestore. */
export async function syncSettingsToCloud(uid: string, settings: Settings): Promise<string> {
  const syncedAt = nowIso();
  const settingsToSync = await mergeSettingsSequenceFromCloud(uid, settings);
  await setDoc(
    doc(firestore, `users/${uid}/settings/${settings.id}`),
    asSyncedRecord(settingsToSync, syncedAt),
  );
  if (settingsToSync.nextBillSequence !== settings.nextBillSequence) {
    await db.settings.update(settings.id, { nextBillSequence: settingsToSync.nextBillSequence });
  }
  return syncedAt;
}

/**
 * Merge only the bill sequence after an offline bill. This keeps bill numbers
 * monotonic without overwriting store settings from another device.
 */
export async function syncBillSequenceToCloud(uid: string, settings: Settings): Promise<Settings> {
  const syncedAt = nowIso();
  const settingsRef = doc(firestore, `users/${uid}/settings/${settings.id}`);
  return runTransaction(firestore, async (transaction) => {
    const snap = await transaction.get(settingsRef);
    const cloud = snap.exists() ? (snap.data() as Settings) : null;
    const merged = asSyncedRecord(
      cloud
        ? {
            ...cloud,
            nextBillSequence: Math.max(settings.nextBillSequence || 1, cloud.nextBillSequence || 1),
            updatedAt: newestIso(cloud.updatedAt, settings.updatedAt, syncedAt),
          }
        : settings,
      syncedAt,
    );
    transaction.set(settingsRef, stripUndefined(merged));
    return merged;
  });
}

/**
 * Full sync of all local tables → Firestore.
 * Returns SyncMeta on success, null on failure.
 * Safe to fire-and-forget: `void syncAllToCloud(uid)`.
 */
export async function syncAllToCloud(uid: string): Promise<SyncMeta | null> {
  try {
    const [activeQueueCount, openConflictCount] = await Promise.all([
      db.syncQueue.where('status').anyOf(['pending', 'failed', 'syncing', 'conflict']).count(),
      db.syncConflicts.where('status').equals('open').count().catch(() => 0),
    ]);
    if (activeQueueCount > 0 || openConflictCount > 0) return null;

    const [bills, billItems, products, stockMovements, customerPayments, localSettings] = await Promise.all([
      db.bills.toArray(),
      db.billItems.toArray(),
      db.products.toArray(),
      db.stockMovements.toArray(),
      db.customerPayments.toArray(),
      db.settings.toArray(),
    ]);

    const settings = await Promise.all(
      localSettings.map((setting) => mergeSettingsSequenceFromCloud(uid, setting)),
    );

    const preflightJobs: SyncQueueItem[] = [
      ...products.map((product) => ({
        id: `sq:product:${product.id}`,
        entity: 'product' as const,
        entityId: product.id,
        operation: 'upsert' as const,
        status: 'pending' as const,
        retryCount: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      })),
      ...settings.map((setting) => ({
        id: `sq:settings:${setting.id}`,
        entity: 'settings' as const,
        entityId: setting.id,
        operation: 'upsert' as const,
        status: 'pending' as const,
        retryCount: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      })),
    ];

    for (const product of products) {
      const job = preflightJobs.find((item) => item.entity === 'product' && item.entityId === product.id);
      if (job) {
        const conflict = await detectProductCloudConflict(uid, product, job);
        if (conflict.hasConflict) return null;
      }
    }

    for (const setting of settings) {
      const job = preflightJobs.find((item) => item.entity === 'settings' && item.entityId === setting.id);
      if (job) {
        const conflict = await detectSettingsCloudConflict(uid, setting, job);
        if (conflict.hasConflict) return null;
      }
    }

    const syncedAt = nowIso();
    const writes = [
      ...bills.map((b) => ({
        ref: doc(firestore, `users/${uid}/bills/${b.id}`),
        data: asSyncedRecord(b, syncedAt),
      })),
      ...billItems.map((i) => ({
        ref: doc(firestore, `users/${uid}/billItems/${i.id}`),
        data: stripUndefined(i),
      })),
      ...products.map((p) => ({
        ref: doc(firestore, `users/${uid}/products/${p.id}`),
        data: asSyncedRecord(p, syncedAt),
      })),
      ...stockMovements.map((s) => ({
        ref: doc(firestore, `users/${uid}/stockMovements/${s.id}`),
        data: asSyncedRecord(s, syncedAt),
      })),
      ...customerPayments.map((payment) => ({
        ref: doc(firestore, `users/${uid}/customerPayments/${payment.id}`),
        data: asSyncedRecord(payment, syncedAt),
      })),
      ...settings.map((s) => ({
        ref: doc(firestore, `users/${uid}/settings/${s.id}`),
        data: asSyncedRecord(s, syncedAt),
      })),
    ];

    await commitInBatches(writes);

    const meta: SyncMeta = {
      lastSyncedAt: syncedAt,
      recordCounts: {
        bills: bills.length,
        billItems: billItems.length,
        products: products.length,
        stockMovements: stockMovements.length,
        customerPayments: customerPayments.length,
      },
    };
    await setDoc(doc(firestore, `users/${uid}/meta/sync`), meta);

    await db.transaction('rw', [db.bills, db.products, db.stockMovements, db.customerPayments, db.settings, db.syncQueue], async () => {
      await Promise.all([
        db.bills.toCollection().modify({ syncStatus: 'synced', syncedAt, lastSyncError: undefined }),
        db.products.toCollection().modify({ syncStatus: 'synced', syncedAt, lastSyncError: undefined }),
        db.stockMovements.toCollection().modify({ syncStatus: 'synced', syncedAt, lastSyncError: undefined }),
        db.customerPayments.toCollection().modify({ syncStatus: 'synced', syncedAt, lastSyncError: undefined }),
        settings.length
          ? db.settings.bulkPut(settings.map((setting) => asSyncedRecord(setting, syncedAt)))
          : Promise.resolve(),
        db.syncQueue.where('status').anyOf(['pending', 'failed', 'syncing']).modify({ status: 'synced', syncedAt, updatedAt: syncedAt, lastError: undefined }),
      ]);
    });

    // Cache locally so Settings page can read it without a Firestore round-trip
    try {
      localStorage.setItem(`shopkeeper_last_sync_${uid}`, JSON.stringify(meta));
    } catch { /* non-fatal */ }

    return meta;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.warn('[sync] syncAllToCloud failed', e);
    return null;
  }
}

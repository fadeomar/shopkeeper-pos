import { writeBatch, doc, setDoc } from 'firebase/firestore';
import { firestore } from './config';
import { db } from '@/lib/db/schema';
import { nowIso } from '@/lib/utils/date';
import type { Bill, BillItem, Product, Settings, StockMovement } from '@/types/domain';

const BATCH_SIZE = 400; // Firestore max is 500; stay under

export interface SyncMeta {
  lastSyncedAt: string;
  recordCounts: {
    bills: number;
    billItems: number;
    products: number;
    stockMovements: number;
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

async function commitInBatches(
  writes: Array<{ ref: ReturnType<typeof doc>; data: object }>,
): Promise<void> {
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = writeBatch(firestore);
    writes.slice(i, i + BATCH_SIZE).forEach(({ ref, data }) => batch.set(ref, stripUndefined(data)));
    await batch.commit();
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

/** Push a single settings document to Firestore. */
export async function syncSettingsToCloud(uid: string, settings: Settings): Promise<string> {
  const syncedAt = nowIso();
  await setDoc(
    doc(firestore, `users/${uid}/settings/${settings.id}`),
    asSyncedRecord(settings, syncedAt),
  );
  return syncedAt;
}

/**
 * Full sync of all local tables → Firestore.
 * Returns SyncMeta on success, null on failure.
 * Safe to fire-and-forget: `void syncAllToCloud(uid)`.
 */
export async function syncAllToCloud(uid: string): Promise<SyncMeta | null> {
  try {
    const [bills, billItems, products, stockMovements, settings] = await Promise.all([
      db.bills.toArray(),
      db.billItems.toArray(),
      db.products.toArray(),
      db.stockMovements.toArray(),
      db.settings.toArray(),
    ]);

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
      },
    };
    await setDoc(doc(firestore, `users/${uid}/meta/sync`), meta);

    await db.transaction('rw', [db.bills, db.products, db.stockMovements, db.settings, db.syncQueue], async () => {
      await Promise.all([
        db.bills.toCollection().modify({ syncStatus: 'synced', syncedAt, lastSyncError: undefined }),
        db.products.toCollection().modify({ syncStatus: 'synced', syncedAt, lastSyncError: undefined }),
        db.stockMovements.toCollection().modify({ syncStatus: 'synced', syncedAt, lastSyncError: undefined }),
        db.settings.toCollection().modify({ syncStatus: 'synced', syncedAt, lastSyncError: undefined }),
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

import { writeBatch, doc, setDoc } from 'firebase/firestore';
import { firestore } from './config';
import { db } from '@/lib/db/schema';
import type { Bill, BillItem, Product, Settings } from '@/types/domain';

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

async function commitInBatches(
  writes: Array<{ ref: ReturnType<typeof doc>; data: object }>,
): Promise<void> {
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = writeBatch(firestore);
    writes.slice(i, i + BATCH_SIZE).forEach(({ ref, data }) => batch.set(ref, data));
    await batch.commit();
  }
}

export async function syncBillToCloud(
  uid: string,
  bill: Bill,
  items: BillItem[],
): Promise<void> {
  const writes = [
    { ref: doc(firestore, `users/${uid}/bills/${bill.id}`), data: bill },
    ...items.map((item) => ({
      ref: doc(firestore, `users/${uid}/billItems/${item.id}`),
      data: item,
    })),
  ];
  await commitInBatches(writes);
}

export async function syncProductsToCloud(
  uid: string,
  products: Product[],
): Promise<void> {
  if (products.length === 0) return;
  const writes = products.map((p) => ({
    ref: doc(firestore, `users/${uid}/products/${p.id}`),
    data: p,
  }));
  await commitInBatches(writes);
}

/**
 * Immediately push a single settings document to Firestore.
 * Called after every settings save so the cloud is always up-to-date.
 */
export async function syncSettingsToCloud(uid: string, settings: Settings): Promise<void> {
  await setDoc(doc(firestore, `users/${uid}/settings/${settings.id}`), settings);
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

    const writes = [
      ...bills.map((b) => ({
        ref: doc(firestore, `users/${uid}/bills/${b.id}`),
        data: b,
      })),
      ...billItems.map((i) => ({
        ref: doc(firestore, `users/${uid}/billItems/${i.id}`),
        data: i,
      })),
      ...products.map((p) => ({
        ref: doc(firestore, `users/${uid}/products/${p.id}`),
        data: p,
      })),
      ...stockMovements.map((s) => ({
        ref: doc(firestore, `users/${uid}/stockMovements/${s.id}`),
        data: s,
      })),
      ...settings.map((s) => ({
        ref: doc(firestore, `users/${uid}/settings/${s.id}`),
        data: s,
      })),
    ];

    await commitInBatches(writes);

    // Write sync metadata to Firestore
    const meta: SyncMeta = {
      lastSyncedAt: new Date().toISOString(),
      recordCounts: {
        bills: bills.length,
        billItems: billItems.length,
        products: products.length,
        stockMovements: stockMovements.length,
      },
    };
    await setDoc(doc(firestore, `users/${uid}/meta/sync`), meta);

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

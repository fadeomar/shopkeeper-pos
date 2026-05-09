import { collection, getDocs, getDoc, doc } from 'firebase/firestore';
import { firestore } from './config';
import { db } from '@/lib/db/schema';
import type { Bill, BillItem, Product, StockMovement, Settings } from '@/types/domain';
import type { SyncMeta } from './sync-service';

/**
 * Pull the user's settings from Firestore and write to Dexie only if the
 * cloud copy is newer (last-write-wins via updatedAt).
 * Returns the updated Settings if local was overwritten, or null if local was already current.
 */
export async function pullSettingsFromCloud(uid: string): Promise<Settings | null> {
  try {
    const snap = await getDocs(collection(firestore, `users/${uid}/settings`));
    if (snap.empty) return null;

    const cloud = snap.docs[0].data() as Settings;
    if (!db.isOpen()) await db.open();

    const local = await db.settings.get(cloud.id);

    // Only overwrite local if cloud is strictly newer
    if (!local || cloud.updatedAt > local.updatedAt) {
      await db.settings.put(cloud);
      return cloud;
    }
    return null; // local is current or newer — no change
  } catch {
    return null; // offline or permission error — skip silently
  }
}

export type { SyncMeta };

/**
 * Fetch the sync metadata doc for a user.
 * Returns null if the user has never done a full sync or is offline.
 */
export async function fetchSyncMeta(uid: string): Promise<SyncMeta | null> {
  try {
    const snap = await getDoc(doc(firestore, `users/${uid}/meta/sync`));
    return snap.exists() ? (snap.data() as SyncMeta) : null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the local DB has no bills and no products.
 * Used to detect a fresh/empty device before offering a restore.
 */
export async function isLocalDbEmpty(): Promise<boolean> {
  try {
    if (!db.isOpen()) await db.open();
    const [billCount, productCount] = await Promise.all([
      db.bills.count(),
      db.products.count(),
    ]);
    return billCount === 0 && productCount === 0;
  } catch {
    return false; // if DB is broken, don't offer restore
  }
}

/**
 * Download all Firestore subcollections for a user and write them into
 * the local Dexie DB. Replaces any existing local records (bulkPut).
 *
 * @param onProgress - optional callback for step-by-step status messages
 */
export async function restoreFromCloud(
  uid: string,
  onProgress?: (step: string) => void,
): Promise<void> {
  if (!db.isOpen()) await db.open();

  onProgress?.('Fetching bills…');
  const billsSnap = await getDocs(collection(firestore, `users/${uid}/bills`));
  const bills = billsSnap.docs.map((d) => d.data() as Bill);

  onProgress?.('Fetching bill items…');
  const billItemsSnap = await getDocs(collection(firestore, `users/${uid}/billItems`));
  const billItems = billItemsSnap.docs.map((d) => d.data() as BillItem);

  onProgress?.('Fetching products…');
  const productsSnap = await getDocs(collection(firestore, `users/${uid}/products`));
  const products = productsSnap.docs.map((d) => d.data() as Product);

  onProgress?.('Fetching stock movements…');
  const movementsSnap = await getDocs(collection(firestore, `users/${uid}/stockMovements`));
  const stockMovements = movementsSnap.docs.map((d) => d.data() as StockMovement);

  onProgress?.('Fetching settings…');
  const settingsSnap = await getDocs(collection(firestore, `users/${uid}/settings`));
  const settings = settingsSnap.docs.map((d) => d.data() as Settings);

  onProgress?.('Writing to local database…');
  await db.transaction(
    'rw',
    [db.bills, db.billItems, db.products, db.stockMovements, db.settings],
    async () => {
      // Clear first so stale local rows that no longer exist in the cloud are removed.
      await Promise.all([
        db.bills.clear(),
        db.billItems.clear(),
        db.products.clear(),
        db.stockMovements.clear(),
        db.settings.clear(),
      ]);
      if (bills.length)          await db.bills.bulkPut(bills);
      if (billItems.length)      await db.billItems.bulkPut(billItems);
      if (products.length)       await db.products.bulkPut(products);
      if (stockMovements.length) await db.stockMovements.bulkPut(stockMovements);
      if (settings.length)       await db.settings.bulkPut(settings);
    },
  );

  // Record restore time in localStorage so Settings shows it
  try {
    const meta: SyncMeta = {
      lastSyncedAt: new Date().toISOString(),
      recordCounts: {
        bills: bills.length,
        billItems: billItems.length,
        products: products.length,
        stockMovements: stockMovements.length,
      },
    };
    localStorage.setItem(`shopkeeper_last_sync_${uid}`, JSON.stringify(meta));
  } catch { /* non-fatal */ }
}

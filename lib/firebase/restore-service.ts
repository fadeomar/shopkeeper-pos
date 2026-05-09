import { collection, getDocs, getDoc, doc, type QueryDocumentSnapshot, type DocumentData } from 'firebase/firestore';
import { firestore } from './config';
import { db } from '@/lib/db/schema';
import { createBillNumber } from '@/lib/utils/id';
import type { Bill, BillItem, Product, StockMovement, Settings } from '@/types/domain';
import type { SyncMeta } from './sync-service';

const SETTINGS_ID = 'app-settings';

export class RestoreError extends Error {
  readonly code?: string;
  readonly cause?: unknown;

  constructor(message: string, options?: { code?: string; cause?: unknown }) {
    super(message);
    this.name = 'RestoreError';
    this.code = options?.code;
    this.cause = options?.cause;
  }
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function getRawErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getRestoreErrorMessage(error: unknown): string {
  if (error instanceof RestoreError) return error.message;

  const code = getErrorCode(error);
  if (code === 'permission-denied') {
    return 'Restore failed because this account does not have permission to read the backup data.';
  }
  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return 'Restore failed because the cloud backup is temporarily unavailable. Check the connection and try again.';
  }
  if (code === 'unauthenticated') {
    return 'Restore failed because the login session is no longer valid. Sign in again and retry.';
  }

  return 'Restore failed. Check your connection and try again.';
}

function syncedMeta(syncedAt: string) {
  return {
    syncStatus: 'synced' as const,
    syncedAt,
    lastSyncError: undefined,
  };
}

function withDocId<T extends { id: string }>(snapshot: QueryDocumentSnapshot<DocumentData>): T {
  const data = snapshot.data() as Partial<T>;
  return {
    ...data,
    id: typeof data.id === 'string' && data.id.trim() ? data.id : snapshot.id,
  } as T;
}

function normalizeBill(snapshot: QueryDocumentSnapshot<DocumentData>, syncedAt: string): Bill {
  return { ...withDocId<Bill>(snapshot), ...syncedMeta(syncedAt) };
}

function normalizeBillItem(snapshot: QueryDocumentSnapshot<DocumentData>): BillItem {
  return withDocId<BillItem>(snapshot);
}

function normalizeProduct(snapshot: QueryDocumentSnapshot<DocumentData>, syncedAt: string): Product {
  return { ...withDocId<Product>(snapshot), ...syncedMeta(syncedAt) };
}

function normalizeStockMovement(snapshot: QueryDocumentSnapshot<DocumentData>, syncedAt: string): StockMovement {
  return { ...withDocId<StockMovement>(snapshot), ...syncedMeta(syncedAt) };
}

function normalizeSettings(snapshot: QueryDocumentSnapshot<DocumentData>, syncedAt: string): Settings {
  const data = snapshot.data() as Partial<Settings>;
  return {
    ...data,
    id: typeof data.id === 'string' && data.id.trim() ? data.id : SETTINGS_ID,
    ...syncedMeta(syncedAt),
  } as Settings;
}

async function readUserCollection<T>(
  uid: string,
  collectionName: string,
  mapDoc: (snapshot: QueryDocumentSnapshot<DocumentData>) => T,
): Promise<T[]> {
  try {
    const snap = await getDocs(collection(firestore, `users/${uid}/${collectionName}`));
    return snap.docs.map(mapDoc);
  } catch (error) {
    const code = getErrorCode(error);
    const reason = code ? ` (${code})` : '';
    throw new RestoreError(
      `Could not read ${collectionName} from the cloud backup${reason}.`,
      { code, cause: error },
    );
  }
}


function getBillSequenceFromNumber(billNumber: string | undefined): number | null {
  if (!billNumber) return null;
  const match = billNumber.match(/^(?:INV-)?(\d+)$/i) ?? billNumber.match(/(\d+)$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function makeUniqueBillNumber(usedBillNumbers: Set<string>, nextSequence: { value: number }): string {
  let candidate = createBillNumber(nextSequence.value);
  while (usedBillNumbers.has(candidate)) {
    nextSequence.value += 1;
    candidate = createBillNumber(nextSequence.value);
  }
  usedBillNumbers.add(candidate);
  nextSequence.value += 1;
  return candidate;
}

function normalizeUniqueBillNumbers(bills: Bill[]): Bill[] {
  const maxSequence = bills.reduce((max, bill) => {
    const sequence = getBillSequenceFromNumber(bill.billNumber);
    return sequence ? Math.max(max, sequence) : max;
  }, 0);

  const nextSequence = { value: maxSequence + 1 };
  const usedBillNumbers = new Set<string>();
  const sortedBills = [...bills].sort((a, b) => {
    const byDate = (a.createdAt || '').localeCompare(b.createdAt || '');
    return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
  });
  const repairedBillNumbers = new Map<string, string>();

  for (const bill of sortedBills) {
    const current = bill.billNumber?.trim();
    if (current && !usedBillNumbers.has(current)) {
      usedBillNumbers.add(current);
      repairedBillNumbers.set(bill.id, current);
      continue;
    }

    repairedBillNumbers.set(bill.id, makeUniqueBillNumber(usedBillNumbers, nextSequence));
  }

  return bills.map((bill) => {
    const billNumber = repairedBillNumbers.get(bill.id) ?? makeUniqueBillNumber(usedBillNumbers, nextSequence);
    if (billNumber === bill.billNumber) return bill;

    const previousNumber = bill.billNumber?.trim();
    const restoreNote = previousNumber
      ? `Restored from cloud backup. Original duplicate bill number: ${previousNumber}.`
      : 'Restored from cloud backup. Missing bill number was regenerated.';

    return {
      ...bill,
      billNumber,
      notes: bill.notes ? `${bill.notes}\n${restoreNote}` : restoreNote,
    };
  });
}


function buildRestoredDefaultSettings(restoredAt: string, nextBillSequence: number): Settings {
  return {
    id: SETTINGS_ID,
    storeName: 'My Shop',
    cashierName: '',
    currency: 'USD',
    allowLossSale: false,
    nextBillSequence,
    lowStockHighlight: true,
    createdAt: restoredAt,
    updatedAt: restoredAt,
    ...syncedMeta(restoredAt),
  };
}

function ensureRestoredSettings(settings: Settings[], bills: Bill[], restoredAt: string): Settings[] {
  const maxSequence = bills.reduce((max, bill) => {
    const sequence = getBillSequenceFromNumber(bill.billNumber);
    return sequence ? Math.max(max, sequence) : max;
  }, 0);

  if (!settings.length) {
    return [buildRestoredDefaultSettings(restoredAt, maxSequence + 1)];
  }

  return settings.map((setting) => ({
    ...setting,
    nextBillSequence: Math.max(setting.nextBillSequence || 1, maxSequence + 1),
  }));
}

function assertNoDuplicateProductBarcodes(products: Product[]) {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];

  for (const product of products) {
    const barcode = product.barcode?.trim();
    if (!barcode) continue;
    const existingId = seen.get(barcode);
    if (existingId && existingId !== product.id) {
      duplicates.push(barcode);
    } else {
      seen.set(barcode, product.id);
    }
  }

  if (duplicates.length) {
    throw new RestoreError(
      `Restore failed because the backup contains duplicate product barcodes: ${duplicates.slice(0, 3).join(', ')}.`,
    );
  }
}

/**
 * Pull the user's settings from Firestore and write to Dexie only if the
 * cloud copy is newer (last-write-wins via updatedAt).
 * Returns the updated Settings if local was overwritten, or null if local was already current.
 */
export async function pullSettingsFromCloud(uid: string): Promise<Settings | null> {
  try {
    const snap = await getDocs(collection(firestore, `users/${uid}/settings`));
    if (snap.empty) return null;

    const syncedAt = new Date().toISOString();
    const cloud = normalizeSettings(snap.docs[0], syncedAt);
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
 * the local Dexie DB. Local tables are cleared only after all cloud data has
 * been fetched and normalized, so a network/rules failure never wipes local data.
 *
 * @param onProgress - optional callback for step-by-step status messages
 */
export async function restoreFromCloud(
  uid: string,
  onProgress?: (step: string) => void,
): Promise<void> {
  if (!db.isOpen()) await db.open();

  const restoredAt = new Date().toISOString();

  onProgress?.('Fetching bills…');
  let bills = await readUserCollection(uid, 'bills', (snapshot) => normalizeBill(snapshot, restoredAt));

  onProgress?.('Fetching bill items…');
  const billItems = await readUserCollection(uid, 'billItems', normalizeBillItem);

  onProgress?.('Fetching products…');
  const products = await readUserCollection(uid, 'products', (snapshot) => normalizeProduct(snapshot, restoredAt));
  assertNoDuplicateProductBarcodes(products);

  onProgress?.('Fetching stock movements…');
  const stockMovements = await readUserCollection(uid, 'stockMovements', (snapshot) => normalizeStockMovement(snapshot, restoredAt));

  onProgress?.('Fetching settings…');
  let settings = await readUserCollection(uid, 'settings', (snapshot) => normalizeSettings(snapshot, restoredAt));

  bills = normalizeUniqueBillNumbers(bills);
  settings = ensureRestoredSettings(settings, bills, restoredAt);

  onProgress?.('Writing to local database…');
  try {
    await db.transaction(
      'rw',
      [db.bills, db.billItems, db.products, db.stockMovements, db.settings, db.syncQueue],
      async () => {
        // Clear first so stale local rows that no longer exist in the cloud are removed.
        // This is still safe because fetch/normalization already succeeded and Dexie
        // rolls back the whole transaction if a write fails.
        await Promise.all([
          db.bills.clear(),
          db.billItems.clear(),
          db.products.clear(),
          db.stockMovements.clear(),
          db.settings.clear(),
          db.syncQueue.clear(),
        ]);
        if (bills.length) await db.bills.bulkPut(bills);
        if (billItems.length) await db.billItems.bulkPut(billItems);
        if (products.length) await db.products.bulkPut(products);
        if (stockMovements.length) await db.stockMovements.bulkPut(stockMovements);
        if (settings.length) await db.settings.bulkPut(settings);
      },
    );
  } catch (error) {
    throw new RestoreError(
      `Could not write the backup into local storage: ${getRawErrorMessage(error)}`,
      { code: getErrorCode(error), cause: error },
    );
  }

  // Record restore time in localStorage so Settings shows it
  try {
    const meta: SyncMeta = {
      lastSyncedAt: restoredAt,
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

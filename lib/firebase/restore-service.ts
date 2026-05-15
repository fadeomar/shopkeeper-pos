import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { firestore } from './config';
import { db } from '@/lib/db/schema';
import { createBillNumber } from '@/lib/utils/id';
import { normalizeBillSplit } from '@/lib/utils/bill-split';
import { normalizePhone } from '@/lib/utils/customer-key';
import type { Bill, BillItem, Customer, Product, Settings, Shift, StockMovement, Supplier, CustomerPayment } from '@/types/domain';
import type { SyncMeta } from './sync-service';

const SETTINGS_ID = 'app-settings';
const BATCH_SIZE = 400;

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

function finiteNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function withDocId<T extends { id: string }>(snapshot: QueryDocumentSnapshot<DocumentData>): T {
  const data = snapshot.data() as Partial<T>;
  return {
    ...data,
    id: typeof data.id === 'string' && data.id.trim() ? data.id : snapshot.id,
  } as T;
}

function normalizeBill(snapshot: QueryDocumentSnapshot<DocumentData>, syncedAt: string): Bill {
  const bill = withDocId<Bill>(snapshot) as Partial<Bill> & { id: string };
  // Older devices may have written this bill before the Bα payment-split
  // migration added cashAmount/cardAmount/creditAmount. Fill in the canonical
  // split here so every restored bill respects the current Bill type contract
  // and downstream readers (reports, ledger, drawer reconciliation) work.
  const withSplit = normalizeBillSplit({
    ...bill,
    status: bill.status ?? 'finalized',
    returnedAmount: bill.returnedAmount ?? 0,
    returnedProfit: bill.returnedProfit ?? 0,
  });
  return {
    ...withSplit,
    ...syncedMeta(syncedAt),
  } as Bill;
}

function normalizeBillItem(snapshot: QueryDocumentSnapshot<DocumentData>): BillItem {
  const item = withDocId<BillItem>(snapshot) as Partial<BillItem> & { id: string };
  return {
    ...item,
    quantityReturned: item.quantityReturned ?? 0,
  } as BillItem;
}

function normalizeProduct(snapshot: QueryDocumentSnapshot<DocumentData>, syncedAt: string): Product {
  const product = withDocId<Product>(snapshot) as Partial<Product> & { id: string };
  const dateAdded = product.dateAdded || product.lastUpdated || syncedAt;
  return {
    ...product,
    barcode: typeof product.barcode === 'string' ? product.barcode.trim() : '',
    name: typeof product.name === 'string' && product.name.trim() ? product.name.trim() : 'Restored product',
    category: typeof product.category === 'string' && product.category.trim() ? product.category.trim() : 'Uncategorized',
    unit: typeof product.unit === 'string' && product.unit.trim() ? product.unit.trim() : 'pcs',
    quantityInStock: Math.max(0, finiteNumber(product.quantityInStock)),
    buyPrice: Math.max(0, finiteNumber(product.buyPrice)),
    sellPrice: Math.max(0, finiteNumber(product.sellPrice)),
    minimumStockAlert: Math.max(0, finiteNumber(product.minimumStockAlert)),
    dateAdded,
    lastUpdated: product.lastUpdated || dateAdded,
    status: product.status ?? 'active',
    ...syncedMeta(syncedAt),
  } as Product;
}

function normalizeStockMovement(snapshot: QueryDocumentSnapshot<DocumentData>, syncedAt: string): StockMovement {
  const movement = withDocId<StockMovement>(snapshot);
  return { ...movement, ...syncedMeta(syncedAt) };
}

function normalizeCustomerPayment(snapshot: QueryDocumentSnapshot<DocumentData>, syncedAt: string): CustomerPayment {
  const payment = withDocId<CustomerPayment>(snapshot) as Partial<CustomerPayment> & { id: string };
  return {
    ...payment,
    customerKey: payment.customerKey || '',
    customerName: payment.customerName || 'Customer',
    amount: Math.max(0, finiteNumber(payment.amount)),
    createdAt: payment.createdAt || syncedAt,
    ...syncedMeta(syncedAt),
  } as CustomerPayment;
}

function normalizeShift(snapshot: QueryDocumentSnapshot<DocumentData>, syncedAt: string): Shift {
  const shift = withDocId<Shift>(snapshot) as Partial<Shift> & { id: string };
  return {
    ...shift,
    openedAt: shift.openedAt || syncedAt,
    openedByCashierName: shift.openedByCashierName || 'Cashier',
    openingCash: Math.max(0, finiteNumber(shift.openingCash)),
    status: shift.status === 'closed' ? 'closed' : 'open',
    ...syncedMeta(syncedAt),
  } as Shift;
}

function normalizeSupplier(snapshot: QueryDocumentSnapshot<DocumentData>, syncedAt: string): Supplier {
  const supplier = withDocId<Supplier>(snapshot) as Partial<Supplier> & { id: string };
  const phone = typeof supplier.phone === 'string' ? supplier.phone.trim() : undefined;
  return {
    ...supplier,
    name: typeof supplier.name === 'string' && supplier.name.trim() ? supplier.name.trim() : 'Supplier',
    phone: phone || undefined,
    normalizedPhone: phone ? normalizePhone(phone) || undefined : supplier.normalizedPhone,
    createdAt: supplier.createdAt || syncedAt,
    updatedAt: supplier.updatedAt || supplier.createdAt || syncedAt,
    ...syncedMeta(syncedAt),
  } as Supplier;
}

function normalizeCustomer(snapshot: QueryDocumentSnapshot<DocumentData>, syncedAt: string): Customer {
  const customer = withDocId<Customer>(snapshot) as Partial<Customer> & { id: string };
  const phone = typeof customer.phone === 'string' ? customer.phone.trim() : undefined;
  return {
    ...customer,
    name: typeof customer.name === 'string' && customer.name.trim() ? customer.name.trim() : 'Customer',
    phone: phone || undefined,
    normalizedPhone: phone ? normalizePhone(phone) || undefined : customer.normalizedPhone,
    createdAt: customer.createdAt || syncedAt,
    updatedAt: customer.updatedAt || customer.createdAt || syncedAt,
    ...syncedMeta(syncedAt),
  } as Customer;
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

function appendRestoreNote(existing: string | undefined, note: string): string {
  if (!existing?.trim()) return note;
  return existing.includes(note) ? existing : `${existing}\n${note}`;
}

function productTimeValue(product: Product): number {
  const parsed = Date.parse(product.lastUpdated || product.dateAdded || product.syncedAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function chooseCanonicalProduct(products: Product[]): Product {
  return [...products].sort((a, b) => {
    const byActive = Number(b.status === 'active') - Number(a.status === 'active');
    if (byActive !== 0) return byActive;

    const byUpdated = productTimeValue(b) - productTimeValue(a);
    if (byUpdated !== 0) return byUpdated;

    const byStock = (b.quantityInStock || 0) - (a.quantityInStock || 0);
    if (byStock !== 0) return byStock;

    return a.id.localeCompare(b.id);
  })[0];
}

function makeRestoredBarcode(product: Product, usedBarcodes: Set<string>): string {
  const base = `RESTORED-${product.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) || Date.now()}`;
  let candidate = base;
  let suffix = 2;

  while (usedBarcodes.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  usedBarcodes.add(candidate);
  return candidate;
}

type ProductBackupRepair = {
  products: Product[];
  billItems: BillItem[];
  stockMovements: StockMovement[];
  duplicateProductIds: string[];
  remappedBillItems: BillItem[];
  remappedStockMovements: StockMovement[];
  duplicateBarcodes: string[];
};

function repairDuplicateProductBarcodes(input: {
  products: Product[];
  billItems: BillItem[];
  stockMovements: StockMovement[];
}): ProductBackupRepair {
  const usedBarcodes = new Set(
    input.products
      .map((product) => product.barcode?.trim())
      .filter((barcode): barcode is string => Boolean(barcode)),
  );

  const groups = new Map<string, Product[]>();
  for (const product of input.products) {
    const rawBarcode = product.barcode?.trim();
    const barcode = rawBarcode || makeRestoredBarcode(product, usedBarcodes);
    const safeProduct: Product = rawBarcode
      ? { ...product, barcode }
      : {
          ...product,
          barcode,
          notes: appendRestoreNote(
            product.notes,
            'Restored from cloud backup. Missing barcode was replaced with a temporary restored barcode.',
          ),
        };

    const existing = groups.get(barcode) ?? [];
    existing.push(safeProduct);
    groups.set(barcode, existing);
  }

  const idRemap = new Map<string, string>();
  const products: Product[] = [];
  const duplicateProductIds: string[] = [];
  const duplicateBarcodes: string[] = [];

  for (const [barcode, group] of groups) {
    if (group.length === 1) {
      products.push(group[0]);
      continue;
    }

    const canonical = chooseCanonicalProduct(group);
    const duplicateIds = group
      .filter((product) => product.id !== canonical.id)
      .map((product) => product.id);
    duplicateProductIds.push(...duplicateIds);
    duplicateBarcodes.push(barcode);

    for (const product of group) {
      if (product.id !== canonical.id) idRemap.set(product.id, canonical.id);
    }

    products.push({
      ...canonical,
      barcode,
      status: group.some((product) => product.status === 'active') ? 'active' : canonical.status,
      notes: appendRestoreNote(
        canonical.notes,
        `Restored backup repair: merged ${duplicateIds.length} duplicate product record${duplicateIds.length === 1 ? '' : 's'} for barcode ${barcode}.`,
      ),
    });
  }

  const remappedBillItems: BillItem[] = [];
  const billItems = input.billItems.map((item) => {
    const canonicalId = idRemap.get(item.originalProductId);
    if (!canonicalId) return item;
    const repaired = { ...item, originalProductId: canonicalId };
    remappedBillItems.push(repaired);
    return repaired;
  });

  const remappedStockMovements: StockMovement[] = [];
  const stockMovements = input.stockMovements.map((movement) => {
    const canonicalId = idRemap.get(movement.productId);
    if (!canonicalId) return movement;
    const repaired = { ...movement, productId: canonicalId };
    remappedStockMovements.push(repaired);
    return repaired;
  });

  return {
    products,
    billItems,
    stockMovements,
    duplicateProductIds,
    remappedBillItems,
    remappedStockMovements,
    duplicateBarcodes,
  };
}

async function repairCloudDuplicateProducts(input: {
  uid: string;
  repair: ProductBackupRepair;
  meta: SyncMeta;
}) {
  const { uid, repair, meta } = input;
  if (
    repair.duplicateProductIds.length === 0 &&
    repair.remappedBillItems.length === 0 &&
    repair.remappedStockMovements.length === 0
  ) return;

  const writes: Array<
    | { type: 'set'; ref: ReturnType<typeof doc>; data: object }
    | { type: 'delete'; ref: ReturnType<typeof doc> }
  > = [
    ...repair.products.map((product) => ({
      type: 'set' as const,
      ref: doc(firestore, `users/${uid}/products/${product.id}`),
      data: stripUndefined(product),
    })),
    ...repair.remappedBillItems.map((item) => ({
      type: 'set' as const,
      ref: doc(firestore, `users/${uid}/billItems/${item.id}`),
      data: stripUndefined(item),
    })),
    ...repair.remappedStockMovements.map((movement) => ({
      type: 'set' as const,
      ref: doc(firestore, `users/${uid}/stockMovements/${movement.id}`),
      data: stripUndefined(movement),
    })),
    ...repair.duplicateProductIds.map((id) => ({
      type: 'delete' as const,
      ref: doc(firestore, `users/${uid}/products/${id}`),
    })),
  ];

  for (let index = 0; index < writes.length; index += BATCH_SIZE) {
    const batch = writeBatch(firestore);
    for (const write of writes.slice(index, index + BATCH_SIZE)) {
      if (write.type === 'set') batch.set(write.ref, write.data);
      else batch.delete(write.ref);
    }
    await batch.commit();
  }

  await setDoc(doc(firestore, `users/${uid}/meta/sync`), meta);
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
    const pendingSettingsJob = await db.syncQueue.get(`sq:settings:${cloud.id}`);
    if (pendingSettingsJob && ['pending', 'failed', 'syncing', 'conflict'].includes(pendingSettingsJob.status)) {
      return null;
    }

    // Only overwrite local if cloud is strictly newer. The bill sequence is
    // monotonic, so never pull it backwards.
    if (!local || cloud.updatedAt > local.updatedAt) {
      const merged = local
        ? { ...cloud, nextBillSequence: Math.max(local.nextBillSequence || 1, cloud.nextBillSequence || 1) }
        : cloud;
      await db.settings.put(merged);
      return merged;
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
  const cloudBillItems = await readUserCollection(uid, 'billItems', normalizeBillItem);

  onProgress?.('Fetching products…');
  const cloudProducts = await readUserCollection(uid, 'products', (snapshot) => normalizeProduct(snapshot, restoredAt));

  onProgress?.('Fetching stock movements…');
  const cloudStockMovements = await readUserCollection(uid, 'stockMovements', (snapshot) => normalizeStockMovement(snapshot, restoredAt));

  onProgress?.('Fetching customer payments…');
  const customerPayments = await readUserCollection(uid, 'customerPayments', (snapshot) => normalizeCustomerPayment(snapshot, restoredAt));

  onProgress?.('Fetching customers…');
  const customers = await readUserCollection(uid, 'customers', (snapshot) => normalizeCustomer(snapshot, restoredAt));

  onProgress?.('Fetching shifts…');
  const shifts = await readUserCollection(uid, 'shifts', (snapshot) => normalizeShift(snapshot, restoredAt));

  onProgress?.('Fetching suppliers…');
  const suppliers = await readUserCollection(uid, 'suppliers', (snapshot) => normalizeSupplier(snapshot, restoredAt));

  const productRepair = repairDuplicateProductBarcodes({
    products: cloudProducts,
    billItems: cloudBillItems,
    stockMovements: cloudStockMovements,
  });

  if (productRepair.duplicateProductIds.length) {
    onProgress?.(
      `Repairing duplicate product barcodes (${productRepair.duplicateBarcodes.slice(0, 3).join(', ')})…`,
    );
  }

  onProgress?.('Fetching settings…');
  let settings = await readUserCollection(uid, 'settings', (snapshot) => normalizeSettings(snapshot, restoredAt));

  bills = normalizeUniqueBillNumbers(bills);
  settings = ensureRestoredSettings(settings, bills, restoredAt);

  const meta: SyncMeta = {
    lastSyncedAt: restoredAt,
    recordCounts: {
      bills: bills.length,
      billItems: productRepair.billItems.length,
      products: productRepair.products.length,
      stockMovements: productRepair.stockMovements.length,
      customerPayments: customerPayments.length,
      customers: customers.length,
      shifts: shifts.length,
      suppliers: suppliers.length,
    },
  };

  onProgress?.('Writing to local database…');
  try {
    await db.transaction(
      'rw',
      [db.bills, db.billItems, db.products, db.stockMovements, db.customerPayments, db.customers, db.shifts, db.suppliers, db.settings, db.syncQueue, db.syncConflicts],
      async () => {
        // Clear first so stale local rows that no longer exist in the cloud are removed.
        // This is still safe because fetch/normalization already succeeded and Dexie
        // rolls back the whole transaction if a write fails.
        await Promise.all([
          db.bills.clear(),
          db.billItems.clear(),
          db.products.clear(),
          db.stockMovements.clear(),
          db.customerPayments.clear(),
          db.customers.clear(),
          db.shifts.clear(),
          db.suppliers.clear(),
          db.settings.clear(),
          db.syncQueue.clear(),
          db.syncConflicts.clear(),
        ]);
        if (bills.length) await db.bills.bulkPut(bills);
        if (productRepair.billItems.length) await db.billItems.bulkPut(productRepair.billItems);
        if (productRepair.products.length) await db.products.bulkPut(productRepair.products);
        if (productRepair.stockMovements.length) await db.stockMovements.bulkPut(productRepair.stockMovements);
        if (customerPayments.length) await db.customerPayments.bulkPut(customerPayments);
        if (customers.length) await db.customers.bulkPut(customers);
        if (shifts.length) await db.shifts.bulkPut(shifts);
        if (suppliers.length) await db.suppliers.bulkPut(suppliers);
        if (settings.length) await db.settings.bulkPut(settings);
      },
    );
  } catch (error) {
    throw new RestoreError(
      `Could not write the backup into local storage: ${getRawErrorMessage(error)}`,
      { code: getErrorCode(error), cause: error },
    );
  }

  onProgress?.('Finalizing restore…');
  try {
    localStorage.setItem(`shopkeeper_last_sync_${uid}`, JSON.stringify(meta));
  } catch { /* non-fatal */ }

  // Best effort: clean the cloud backup so future devices do not see the same
  // duplicate barcode records. If this cleanup fails, the local restore is still valid.
  if (productRepair.duplicateProductIds.length) {
    try {
      await repairCloudDuplicateProducts({ uid, repair: productRepair, meta });
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[restore] cloud duplicate repair failed', error);
      }
    }
  }
}

import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import { firestore } from './config';
import type { Bill, BillItem, CustomerPayment, Product, Settings, StockMovement } from '@/types/domain';

export interface CloudSyncMeta {
  lastSyncedAt: string;
  recordCounts?: {
    bills?: number;
    billItems?: number;
    products?: number;
    stockMovements?: number;
    customerPayments?: number;
  };
}

export type SupportHealth = 'healthy' | 'needs_attention' | 'no_backup';

export interface UserSummary {
  billCount: number;
  totalRevenue: number;
  productCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  creditDebt: number;
  lastSyncAt?: string;
  syncHealth: SupportHealth;
}

export interface UserSupportSnapshot extends UserSummary {
  settingsUpdatedAt?: string;
  activeProductCount: number;
  inactiveProductCount: number;
  customerPaymentCount: number;
  stockMovementCount: number;
  voidedBillCount: number;
  returnedBillCount: number;
  cashSales: number;
  cardSales: number;
  creditSales: number;
  warnings: string[];
  syncMeta: CloudSyncMeta | null;
}

function netBillTotal(bill: Bill): number {
  if (bill.status === 'voided') return 0;
  return Math.max(0, bill.totalAmount - (bill.returnedAmount ?? 0));
}

function netBillProfit(bill: Bill): number {
  if (bill.status === 'voided') return 0;
  return Math.max(0, bill.totalProfit - (bill.returnedProfit ?? 0));
}

function backupAgeDays(lastSyncAt?: string): number | null {
  if (!lastSyncAt) return null;
  const then = new Date(lastSyncAt).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

function syncHealth(lastSyncAt?: string): SupportHealth {
  const age = backupAgeDays(lastSyncAt);
  if (age === null) return 'no_backup';
  if (age > 7) return 'needs_attention';
  return 'healthy';
}

export async function fetchUserBills(uid: string, maxRows = 100): Promise<Bill[]> {
  const snap = await getDocs(
    query(
      collection(firestore, `users/${uid}/bills`),
      orderBy('createdAt', 'desc'),
      limit(maxRows),
    ),
  );
  return snap.docs.map((d) => d.data() as Bill);
}

export async function fetchUserBillItems(uid: string): Promise<BillItem[]> {
  const snap = await getDocs(collection(firestore, `users/${uid}/billItems`));
  return snap.docs.map((d) => d.data() as BillItem);
}

export async function fetchUserProducts(uid: string): Promise<Product[]> {
  const snap = await getDocs(
    query(collection(firestore, `users/${uid}/products`), orderBy('name')),
  );
  return snap.docs.map((d) => d.data() as Product);
}

export async function fetchUserStockMovements(uid: string, maxRows = 200): Promise<StockMovement[]> {
  const snap = await getDocs(
    query(
      collection(firestore, `users/${uid}/stockMovements`),
      orderBy('createdAt', 'desc'),
      limit(maxRows),
    ),
  );
  return snap.docs.map((d) => d.data() as StockMovement);
}

export async function fetchUserCustomerPayments(uid: string): Promise<CustomerPayment[]> {
  const snap = await getDocs(
    query(collection(firestore, `users/${uid}/customerPayments`), orderBy('createdAt', 'desc')),
  );
  return snap.docs.map((d) => d.data() as CustomerPayment);
}

export async function fetchUserSyncMeta(uid: string): Promise<CloudSyncMeta | null> {
  try {
    const snap = await getDoc(doc(firestore, `users/${uid}/meta/sync`));
    if (!snap.exists()) return null;
    return snap.data() as CloudSyncMeta;
  } catch {
    return null;
  }
}

/**
 * Fetch the user's settings document from Firestore.
 * Returns null if the user hasn't synced settings yet or is unreachable.
 */
export async function fetchUserSettings(uid: string): Promise<Settings | null> {
  try {
    const snap = await getDocs(collection(firestore, `users/${uid}/settings`));
    if (snap.empty) return null;
    return snap.docs[0].data() as Settings;
  } catch {
    return null;
  }
}

/**
 * Overwrite the user's settings document in Firestore.
 * Called by admin when editing a user's settings from the admin panel.
 * The cashier will pick up the change on next reconnect via pullSettingsFromCloud.
 */
export async function updateUserSettingsInCloud(uid: string, settings: Settings): Promise<void> {
  await setDoc(doc(firestore, `users/${uid}/settings/${settings.id}`), settings);
}

export async function fetchUserSummary(uid: string): Promise<UserSummary> {
  const [bills, products, customerPayments, syncMeta] = await Promise.all([
    fetchUserBills(uid, 1000),
    fetchUserProducts(uid),
    fetchUserCustomerPayments(uid).catch(() => [] as CustomerPayment[]),
    fetchUserSyncMeta(uid),
  ]);

  const activeProducts = products.filter((p) => p.status === 'active');
  const totalRevenue = bills.reduce((sum, b) => sum + netBillTotal(b), 0);
  const creditDueBeforePayments = bills
    .filter((b) => b.paymentMethod === 'credit' && b.status !== 'voided')
    .reduce((sum, b) => sum + Math.max(0, netBillTotal(b) - b.paidAmount), 0);
  const paymentsTotal = customerPayments.reduce((sum, p) => sum + p.amount, 0);

  return {
    billCount: bills.length,
    totalRevenue,
    productCount: products.length,
    lowStockCount: activeProducts.filter((p) => p.quantityInStock > 0 && p.quantityInStock <= p.minimumStockAlert).length,
    outOfStockCount: activeProducts.filter((p) => p.quantityInStock <= 0).length,
    creditDebt: Math.max(0, creditDueBeforePayments - paymentsTotal),
    lastSyncAt: syncMeta?.lastSyncedAt,
    syncHealth: syncHealth(syncMeta?.lastSyncedAt),
  };
}

export async function fetchUserSupportSnapshot(uid: string): Promise<UserSupportSnapshot> {
  const [bills, products, stockMovements, customerPayments, settings, syncMeta] = await Promise.all([
    fetchUserBills(uid, 1000),
    fetchUserProducts(uid),
    fetchUserStockMovements(uid, 300).catch(() => [] as StockMovement[]),
    fetchUserCustomerPayments(uid).catch(() => [] as CustomerPayment[]),
    fetchUserSettings(uid),
    fetchUserSyncMeta(uid),
  ]);

  const activeProducts = products.filter((p) => p.status === 'active');
  const totalRevenue = bills.reduce((sum, b) => sum + netBillTotal(b), 0);
  const creditDueBeforePayments = bills
    .filter((b) => b.paymentMethod === 'credit' && b.status !== 'voided')
    .reduce((sum, b) => sum + Math.max(0, netBillTotal(b) - b.paidAmount), 0);
  const paymentsTotal = customerPayments.reduce((sum, p) => sum + p.amount, 0);
  const creditDebt = Math.max(0, creditDueBeforePayments - paymentsTotal);
  const health = syncHealth(syncMeta?.lastSyncedAt);
  const warnings: string[] = [];

  if (!syncMeta?.lastSyncedAt) warnings.push('No cloud backup metadata found yet. Ask the user to sync once.');
  else {
    const age = backupAgeDays(syncMeta.lastSyncedAt);
    if (age !== null && age > 7) warnings.push(`Last cloud backup is ${age} days old.`);
  }
  if (!settings) warnings.push('No settings backup found yet.');
  if (activeProducts.length === 0) warnings.push('No active products found in backup.');
  const duplicateBarcodes = findDuplicateBarcodes(products);
  if (duplicateBarcodes.length > 0) warnings.push(`Duplicate product barcodes in cloud backup: ${duplicateBarcodes.slice(0, 5).join(', ')}${duplicateBarcodes.length > 5 ? '…' : ''}`);
  const outOfStockCount = activeProducts.filter((p) => p.quantityInStock <= 0).length;
  if (outOfStockCount > 0) warnings.push(`${outOfStockCount} active products are out of stock.`);
  if (creditDebt > 0) warnings.push(`Customer debt balance is ${creditDebt.toFixed(2)}.`);

  return {
    billCount: bills.length,
    totalRevenue,
    productCount: products.length,
    lowStockCount: activeProducts.filter((p) => p.quantityInStock > 0 && p.quantityInStock <= p.minimumStockAlert).length,
    outOfStockCount,
    creditDebt,
    lastSyncAt: syncMeta?.lastSyncedAt,
    syncHealth: health,
    settingsUpdatedAt: settings?.updatedAt,
    activeProductCount: activeProducts.length,
    inactiveProductCount: products.length - activeProducts.length,
    customerPaymentCount: customerPayments.length,
    stockMovementCount: stockMovements.length,
    voidedBillCount: bills.filter((b) => b.status === 'voided').length,
    returnedBillCount: bills.filter((b) => b.status === 'returned' || b.status === 'partially_returned').length,
    cashSales: bills.filter((b) => b.paymentMethod === 'cash').reduce((sum, b) => sum + netBillTotal(b), 0),
    cardSales: bills.filter((b) => b.paymentMethod === 'card').reduce((sum, b) => sum + netBillTotal(b), 0),
    creditSales: bills.filter((b) => b.paymentMethod === 'credit').reduce((sum, b) => sum + netBillTotal(b), 0),
    warnings,
    syncMeta,
  };
}

function findDuplicateBarcodes(products: Product[]): string[] {
  const counts = new Map<string, number>();
  products.forEach((p) => {
    const barcode = p.barcode.trim();
    if (!barcode) return;
    counts.set(barcode, (counts.get(barcode) ?? 0) + 1);
  });
  return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([barcode]) => barcode);
}

export function buildAdminBackupExport(data: {
  uid: string;
  exportedAt: string;
  bills: Bill[];
  products: Product[];
  settings: Settings | null;
  customerPayments: CustomerPayment[];
  stockMovements: StockMovement[];
  syncMeta: CloudSyncMeta | null;
}) {
  return data;
}

export { netBillProfit, netBillTotal };

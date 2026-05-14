import Dexie, { type Table } from 'dexie';
import { db } from '@/lib/db/schema';
import type { AuthCacheEntry, Bill, BillItem, CustomerPayment, Product, Settings, StockMovement, SyncConflict, SyncQueueItem } from '@/types/domain';

const ACTIVE_UID_KEY = 'shopkeeper_active_uid';
const LEGACY_LAST_UID_KEY = 'shopkeeper_last_uid';
const DEVICE_ID_KEY = 'shopkeeper_device_id';

export interface LocalDataSummary {
  products: number; bills: number; billItems: number; stockMovements: number; customerPayments: number; settings: number;
  pending: number; failed: number; syncing: number; blocked: number; conflicts: number; hasBusinessData: boolean; hasUnsyncedWork: boolean;
}

interface AccountSnapshot {
  uid: string; deviceId: string; savedAt: string; summary: LocalDataSummary;
  products: Product[]; bills: Bill[]; billItems: BillItem[]; stockMovements: StockMovement[]; customerPayments: CustomerPayment[];
  settings: Settings[]; authCache: AuthCacheEntry[]; syncQueue: SyncQueueItem[]; syncConflicts: SyncConflict[];
}

class AccountVaultDB extends Dexie { snapshots!: Table<AccountSnapshot, string>; constructor(){ super('shopkeeper-pos-account-vault'); this.version(1).stores({ snapshots: 'uid, savedAt' }); } }
const vault = new AccountVaultDB();

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  const existing = localStorage.getItem(DEVICE_ID_KEY); if (existing) return existing;
  const next = crypto?.randomUUID?.() ?? `device_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(DEVICE_ID_KEY, next); return next;
}
export function getActiveUid(): string | null { if (typeof window === 'undefined') return null; return localStorage.getItem(ACTIVE_UID_KEY) || localStorage.getItem(LEGACY_LAST_UID_KEY); }
export function setActiveUid(uid: string): void { if (typeof window === 'undefined') return; localStorage.setItem(ACTIVE_UID_KEY, uid); localStorage.setItem(LEGACY_LAST_UID_KEY, uid); }

export async function getLocalDataSummary(): Promise<LocalDataSummary> {
  if (!db.isOpen()) { try { await db.open(); } catch {} }
  const [products,bills,billItems,stockMovements,customerPayments,settings,pending,failed,syncing,blocked,conflicts] = await Promise.all([
    db.products.count(), db.bills.count(), db.billItems.count(), db.stockMovements.count(), db.customerPayments.count(), db.settings.count(),
    db.syncQueue.where('status').equals('pending').count(), db.syncQueue.where('status').equals('failed').count(), db.syncQueue.where('status').equals('syncing').count(), db.syncQueue.where('status').equals('blocked').count(),
    db.syncConflicts.where('status').equals('open').count().catch(() => 0),
  ]);
  const hasBusinessData = products + bills + billItems + stockMovements + customerPayments > 0;
  const hasUnsyncedWork = pending + failed + syncing + blocked + conflicts > 0;
  return { products,bills,billItems,stockMovements,customerPayments,settings,pending,failed,syncing,blocked,conflicts,hasBusinessData,hasUnsyncedWork };
}

async function clearRuntimeDb(): Promise<void> { await Promise.all([db.products.clear(),db.bills.clear(),db.billItems.clear(),db.stockMovements.clear(),db.customerPayments.clear(),db.settings.clear(),db.authCache.clear(),db.syncQueue.clear(),db.syncConflicts.clear().catch(()=>undefined)]); }
async function buildSnapshot(uid: string): Promise<AccountSnapshot> {
  const [products,bills,billItems,stockMovements,customerPayments,settings,authCache,syncQueue,syncConflicts] = await Promise.all([db.products.toArray(),db.bills.toArray(),db.billItems.toArray(),db.stockMovements.toArray(),db.customerPayments.toArray(),db.settings.toArray(),db.authCache.toArray(),db.syncQueue.toArray(),db.syncConflicts.toArray().catch(()=>[] as SyncConflict[])]);
  return { uid, deviceId: getOrCreateDeviceId(), savedAt: new Date().toISOString(), summary: await getLocalDataSummary(), products,bills,billItems,stockMovements,customerPayments,settings,authCache,syncQueue,syncConflicts };
}
export async function saveCurrentAccountSnapshot(uid: string): Promise<LocalDataSummary> { const snapshot = await buildSnapshot(uid); await vault.snapshots.put(snapshot); return snapshot.summary; }
export async function restoreAccountSnapshot(uid: string): Promise<boolean> {
  const snapshot = await vault.snapshots.get(uid); await clearRuntimeDb(); if (!snapshot) return false;
  await db.transaction('rw', [db.products,db.bills,db.billItems,db.stockMovements,db.customerPayments,db.settings,db.authCache,db.syncQueue,db.syncConflicts], async()=>{
    if(snapshot.products.length) await db.products.bulkPut(snapshot.products); if(snapshot.bills.length) await db.bills.bulkPut(snapshot.bills); if(snapshot.billItems.length) await db.billItems.bulkPut(snapshot.billItems); if(snapshot.stockMovements.length) await db.stockMovements.bulkPut(snapshot.stockMovements); if(snapshot.customerPayments.length) await db.customerPayments.bulkPut(snapshot.customerPayments); if(snapshot.settings.length) await db.settings.bulkPut(snapshot.settings); if(snapshot.authCache.length) await db.authCache.bulkPut(snapshot.authCache); if(snapshot.syncQueue.length) await db.syncQueue.bulkPut(snapshot.syncQueue); if(snapshot.syncConflicts.length) await db.syncConflicts.bulkPut(snapshot.syncConflicts);
  });
  return true;
}
export async function prepareRuntimeDbForUid(nextUid: string): Promise<void> { const previousUid = getActiveUid(); if (!previousUid || previousUid === nextUid) { setActiveUid(nextUid); return; } await saveCurrentAccountSnapshot(previousUid); await restoreAccountSnapshot(nextUid); setActiveUid(nextUid); }

'use client';

import { useEffect, useRef } from 'react';
import { db } from '@/lib/db/schema';
import {
  applyStockMovementDeltasToCloudProducts,
  syncBillSequenceToCloud,
  syncBillToCloud,
  syncCustomersToCloud,
  syncProductsToCloud,
  syncSettingsToCloud,
  syncShiftsToCloud,
  syncStockMovementsToCloud,
  syncCustomerPaymentsToCloud,
} from '@/lib/firebase/sync-service';
import {
  getPendingSyncJobs,
  getSyncQueueId,
  markSyncing,
  markSynced,
  markFailed,
  markBlocked,
  markConflict,
} from '@/lib/services/sync-queue-service';
import { useAuth } from './auth-context';
import { autoDismissFalseOfflineSaleConflicts, getOpenConflicts } from '@/lib/services/sync-conflict-service';
import { detectProductCloudConflict, prepareSettingsForCloudSync } from '@/lib/firebase/cloud-merge-service';
import { pullCloudChangesBeforePush } from '@/lib/firebase/cloud-pull-service';
import type { Product, Settings, StockMovement, SyncQueueItem, SyncStatus } from '@/types/domain';

const MAX_RETRIES = 5;

const PRODUCT_COMPARE_FIELDS: Array<keyof Product> = [
  'barcode',
  'name',
  'category',
  'brand',
  'unit',
  'quantityInStock',
  'buyPrice',
  'sellPrice',
  'minimumStockAlert',
  'supplierName',
  'expiryDate',
  'shelfLocation',
  'notes',
  'status',
];

function payloadSource(job: SyncQueueItem | undefined): string | undefined {
  return (job?.payload as { source?: string } | undefined)?.source;
}

function isBillSequenceJob(job: SyncQueueItem): boolean {
  return payloadSource(job) === 'bill-sequence';
}

function isActiveQueueStatus(status?: SyncStatus): boolean {
  return (
    status === 'pending' ||
    status === 'failed' ||
    status === 'syncing' ||
    status === 'conflict' ||
    status === 'blocked'
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function productsMatchAfterBillDelta(local: Product, cloud: Product): boolean {
  return PRODUCT_COMPARE_FIELDS.every((field) => sameValue(local[field], cloud[field]));
}

function jobPriority(job: SyncQueueItem): number {
  switch (job.entity) {
    // Customer and shift rows must land in the cloud before any bill that
    // references them; same ordering as SYNC_ENTITY_PRIORITY in
    // sync-queue-service.ts.
    case 'customer':
      return 0;
    case 'shift':
      return 1;
    case 'bill':
      return 2;
    case 'customerPayment':
      return 3;
    case 'stockMovement':
      return 4;
    case 'settings':
      return isBillSequenceJob(job) ? 5 : 7;
    case 'product':
      return 8;
    default:
      return 10;
  }
}

function sortJobs(jobs: SyncQueueItem[]): SyncQueueItem[] {
  return [...jobs].sort((a, b) => jobPriority(a) - jobPriority(b) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

async function syncBillProductDeltas(uid: string, movements: StockMovement[]): Promise<void> {
  const productIds = Array.from(new Set(movements.map((movement) => movement.productId).filter(Boolean)));
  if (productIds.length === 0) return;

  const products = (await db.products.bulkGet(productIds)).filter((product): product is Product => Boolean(product));
  if (products.length === 0) return;

  const { syncedAt, products: cloudProducts } = await applyStockMovementDeltasToCloudProducts(uid, products, movements);
  const cloudById = new Map(cloudProducts.map((product) => [product.id, product]));
  const productJobs = await db.syncQueue.bulkGet(productIds.map((productId) => getSyncQueueId('product', productId)));
  const jobsByProductId = new Map(productJobs.filter((job): job is SyncQueueItem => Boolean(job)).map((job) => [job.entityId, job]));

  await Promise.all(products.map(async (product) => {
    const cloudProduct = cloudById.get(product.id);
    if (!cloudProduct) return;

    const productJob = jobsByProductId.get(product.id);
    if (productJob && isActiveQueueStatus(productJob.status) && !productsMatchAfterBillDelta(product, cloudProduct)) {
      // There is also a real unsynced manual product change. Leave that product
      // job for the normal product conflict check instead of hiding it here.
      return;
    }

    await db.products.put({
      ...cloudProduct,
      syncStatus: 'synced',
      syncedAt,
      lastSyncError: undefined,
    });

    if (productJob && isActiveQueueStatus(productJob.status)) {
      await markSynced(productJob.id);
    }
  }));
}

async function processJob(uid: string, job: SyncQueueItem): Promise<void> {
  // A job that has burned through its retry budget without succeeding needs
  // human attention. Mark it `blocked` so it shows up in Device Health with
  // a clear "manual retry required" affordance instead of silently being
  // skipped on every sync run.
  if ((job.retryCount ?? 0) >= MAX_RETRIES) {
    if (job.status !== 'blocked') {
      const message = `Sync stopped after ${MAX_RETRIES} failed attempts. Manual retry required.`;
      await markBlocked(job.id, message);
      if (job.entity === 'bill') {
        await db.bills.update(job.entityId, { syncStatus: 'blocked', lastSyncError: message });
      } else if (job.entity === 'product') {
        await db.products.update(job.entityId, { syncStatus: 'blocked', lastSyncError: message });
      } else if (job.entity === 'stockMovement') {
        await db.stockMovements.update(job.entityId, { syncStatus: 'blocked', lastSyncError: message });
      } else if (job.entity === 'customerPayment') {
        await db.customerPayments.update(job.entityId, { syncStatus: 'blocked', lastSyncError: message });
      } else if (job.entity === 'customer') {
        await db.customers.update(job.entityId, { syncStatus: 'blocked', lastSyncError: message });
      } else if (job.entity === 'shift') {
        await db.shifts.update(job.entityId, { syncStatus: 'blocked', lastSyncError: message });
      } else if (job.entity === 'settings') {
        await db.settings.update(job.entityId, { syncStatus: 'blocked', lastSyncError: message });
      }
    }
    return;
  }

  await markSyncing(job.id);
  try {
    if (job.entity === 'bill') {
      const [bill, items, movements] = await Promise.all([
        db.bills.get(job.entityId),
        db.billItems.where('billId').equals(job.entityId).toArray(),
        db.stockMovements.where('referenceId').equals(job.entityId).toArray(),
      ]);
      if (!bill) {
        await markSynced(job.id);
        return;
      }

      const syncedAt = await syncBillToCloud(uid, bill, items, movements);
      await syncBillProductDeltas(uid, movements);

      await db.transaction('rw', db.bills, db.stockMovements, async () => {
        await db.bills.update(job.entityId, { syncStatus: 'synced', syncedAt, lastSyncError: undefined });
        await Promise.all(
          movements.map((movement) =>
            db.stockMovements.update(movement.id, { syncStatus: 'synced', syncedAt, lastSyncError: undefined }),
          ),
        );
      });

      await Promise.all(
        movements.map((movement) => markSynced(getSyncQueueId('stockMovement', movement.id))),
      );
    } else if (job.entity === 'product') {
      const product = await db.products.get(job.entityId);
      if (!product) {
        await markSynced(job.id);
        return;
      }

      const conflict = await detectProductCloudConflict(uid, product, job);
      if (conflict.hasConflict) {
        await markConflict(job.id, 'Cloud data changed before this product synced. Review the conflict.');
        await db.products.update(job.entityId, { syncStatus: 'conflict', lastSyncError: 'Needs conflict review' });
        return;
      }

      const syncedAt = await syncProductsToCloud(uid, [product]);
      if (syncedAt) {
        await db.products.update(job.entityId, { syncStatus: 'synced', syncedAt, lastSyncError: undefined });
      }
    } else if (job.entity === 'stockMovement') {
      const movement = await db.stockMovements.get(job.entityId);
      if (!movement) {
        await markSynced(job.id);
        return;
      }
      const syncedAt = await syncStockMovementsToCloud(uid, [movement]);
      if (syncedAt) {
        await db.stockMovements.update(job.entityId, { syncStatus: 'synced', syncedAt, lastSyncError: undefined });
      }
    } else if (job.entity === 'customerPayment') {
      const payment = await db.customerPayments.get(job.entityId);
      if (!payment) {
        await markSynced(job.id);
        return;
      }
      const syncedAt = await syncCustomerPaymentsToCloud(uid, [payment]);
      if (syncedAt) {
        await db.customerPayments.update(job.entityId, { syncStatus: 'synced', syncedAt, lastSyncError: undefined });
      }
    } else if (job.entity === 'customer') {
      const customer = await db.customers.get(job.entityId);
      if (!customer) {
        await markSynced(job.id);
        return;
      }
      const syncedAt = await syncCustomersToCloud(uid, [customer]);
      if (syncedAt) {
        await db.customers.update(job.entityId, { syncStatus: 'synced', syncedAt, lastSyncError: undefined });
      }
    } else if (job.entity === 'shift') {
      const shift = await db.shifts.get(job.entityId);
      if (!shift) {
        await markSynced(job.id);
        return;
      }
      const syncedAt = await syncShiftsToCloud(uid, [shift]);
      if (syncedAt) {
        await db.shifts.update(job.entityId, { syncStatus: 'synced', syncedAt, lastSyncError: undefined });
      }
    } else if (job.entity === 'settings') {
      const settings = await db.settings.get(job.entityId);
      if (!settings) {
        await markSynced(job.id);
        return;
      }

      if (isBillSequenceJob(job)) {
        const merged = await syncBillSequenceToCloud(uid, settings as Settings);
        await db.settings.put({ ...merged, syncStatus: 'synced', lastSyncError: undefined });
      } else {
        const prepared = await prepareSettingsForCloudSync(uid, settings, job);
        if (prepared.hasConflict) {
          await markConflict(job.id, 'Cloud settings changed before this device synced. Review the conflict.');
          await db.settings.update(job.entityId, { syncStatus: 'conflict', lastSyncError: 'Needs conflict review' });
          return;
        }

        const syncedAt = await syncSettingsToCloud(uid, prepared.settings);
        await db.settings.put({
          ...prepared.settings,
          syncStatus: 'synced',
          syncedAt,
          lastSyncError: undefined,
        });
      }
    }

    await markSynced(job.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markFailed(job.id, msg);
    if (job.entity === 'bill') {
      await db.bills.update(job.entityId, { syncStatus: 'failed', lastSyncError: msg });
    } else if (job.entity === 'product') {
      await db.products.update(job.entityId, { syncStatus: 'failed', lastSyncError: msg });
    } else if (job.entity === 'stockMovement') {
      await db.stockMovements.update(job.entityId, { syncStatus: 'failed', lastSyncError: msg });
    } else if (job.entity === 'customerPayment') {
      await db.customerPayments.update(job.entityId, { syncStatus: 'failed', lastSyncError: msg });
    } else if (job.entity === 'customer') {
      await db.customers.update(job.entityId, { syncStatus: 'failed', lastSyncError: msg });
    } else if (job.entity === 'shift') {
      await db.shifts.update(job.entityId, { syncStatus: 'failed', lastSyncError: msg });
    } else if (job.entity === 'settings') {
      await db.settings.update(job.entityId, { syncStatus: 'failed', lastSyncError: msg });
    }
  }
}

async function processJobs(uid: string, jobs: SyncQueueItem[]): Promise<void> {
  for (const job of sortJobs(jobs)) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) break;
    const freshJob = await db.syncQueue.get(job.id);
    if (!freshJob || freshJob.status === 'synced') continue;
    await processJob(uid, freshJob);

    const conflicts = await getOpenConflicts();
    if (conflicts.length > 0) break;
  }
}

export async function runSync(uid: string): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  await autoDismissFalseOfflineSaleConflicts();
  const openConflicts = await getOpenConflicts();
  if (openConflicts.length > 0) return;

  const jobs = await getPendingSyncJobs();
  if (jobs.length === 0) {
    await pullCloudChangesBeforePush(uid);
    await autoDismissFalseOfflineSaleConflicts();
    return;
  }

  // Push the durable offline queue first. Offline bills intentionally change
  // product stock and the bill sequence; pulling products before the bill is
  // pushed can misread those expected local changes as cloud conflicts.
  await processJobs(uid, jobs);

  await autoDismissFalseOfflineSaleConflicts();
  const conflictsAfterPush = await getOpenConflicts();
  if (conflictsAfterPush.length > 0) return;

  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  await pullCloudChangesBeforePush(uid);
  await autoDismissFalseOfflineSaleConflicts();

  const remainingJobs = await getPendingSyncJobs();
  if (remainingJobs.length > 0) await processJobs(uid, remainingJobs);
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const runningRef = useRef(false);

  useEffect(() => {
    if (!user?.uid) return;
    const uid = user.uid;

    const requestSync = () => {
      if (runningRef.current) return;
      runningRef.current = true;
      void runSync(uid).finally(() => {
        runningRef.current = false;
      });
    };

    requestSync();

    // The original triggers (app start, online event, local write event) only
    // fire on this device's activity. They don't cover the cross-device case
    // where another device pushes new bills to the cloud — without an explicit
    // pull, this device keeps showing stale data until the user does something
    // that fires a sync. Two extra triggers below cover that:
    //
    //   1. visibilitychange — when the tab/app becomes visible again (Alt-Tab
    //      back, switching browser tabs, returning from background), pull.
    //   2. periodic poll while visible + online — runs every 30 s. The
    //      runningRef guard inside requestSync makes overlapping calls no-ops,
    //      and pullCloudChangesBeforePush is a no-op when there is nothing
    //      new to pull, so the bandwidth cost is bounded by the actual delta.
    function handleVisibilityChange() {
      if (typeof document === 'undefined') return;
      if (document.visibilityState !== 'visible') return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      requestSync();
    }

    const pollInterval = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      requestSync();
    }, 30_000);

    window.addEventListener('online', requestSync);
    window.addEventListener('shopkeeper:sync-requested', requestSync);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('online', requestSync);
      window.removeEventListener('shopkeeper:sync-requested', requestSync);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(pollInterval);
    };
  }, [user?.uid]);

  return <>{children}</>;
}

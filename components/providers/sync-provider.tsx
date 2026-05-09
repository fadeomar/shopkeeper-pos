'use client';

import { useEffect, useRef } from 'react';
import { db } from '@/lib/db/schema';
import {
  syncBillToCloud,
  syncProductsToCloud,
  syncSettingsToCloud,
  syncStockMovementsToCloud,
} from '@/lib/firebase/sync-service';
import {
  getPendingSyncJobs,
  getSyncQueueId,
  markSyncing,
  markSynced,
  markFailed,
} from '@/lib/services/sync-queue-service';
import { useAuth } from './auth-context';
import type { Product, SyncQueueItem } from '@/types/domain';

const MAX_RETRIES = 5;

async function processJob(uid: string, job: SyncQueueItem): Promise<void> {
  if ((job.retryCount ?? 0) >= MAX_RETRIES) return;

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
      await db.transaction('rw', db.bills, db.stockMovements, async () => {
        await db.bills.update(job.entityId, { syncStatus: 'synced', syncedAt, lastSyncError: undefined });
        await Promise.all(
          movements.map((movement) =>
            db.stockMovements.update(movement.id, { syncStatus: 'synced', syncedAt, lastSyncError: undefined }),
          ),
        );
      });

      // A bill changes product stock. Keep product backups fresh as part of the same sync pass.
      const productIds = Array.from(new Set(items.map((item) => item.originalProductId)));
      const products = (await db.products.bulkGet(productIds)).filter((product): product is Product => Boolean(product));
      if (products.length > 0) {
        const productsSyncedAt = await syncProductsToCloud(uid, products);
        if (productsSyncedAt) {
          await Promise.all([
            ...products.map((product) =>
              db.products.update(product.id, { syncStatus: 'synced', syncedAt: productsSyncedAt, lastSyncError: undefined }),
            ),
            ...products.map((product) => markSynced(getSyncQueueId('product', product.id))),
          ]);
        }
      }

      await Promise.all(
        movements.map((movement) => markSynced(getSyncQueueId('stockMovement', movement.id))),
      );
    } else if (job.entity === 'product') {
      const product = await db.products.get(job.entityId);
      if (!product) {
        await markSynced(job.id);
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
    } else if (job.entity === 'settings') {
      const settings = await db.settings.get(job.entityId);
      if (!settings) {
        await markSynced(job.id);
        return;
      }
      const syncedAt = await syncSettingsToCloud(uid, settings);
      await db.settings.update(job.entityId, { syncStatus: 'synced', syncedAt, lastSyncError: undefined });
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
    } else if (job.entity === 'settings') {
      await db.settings.update(job.entityId, { syncStatus: 'failed', lastSyncError: msg });
    }
  }
}

async function runSync(uid: string): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const jobs = await getPendingSyncJobs();
  for (const job of jobs) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) break;
    const freshJob = await db.syncQueue.get(job.id);
    if (!freshJob || freshJob.status === 'synced') continue;
    await processJob(uid, freshJob);
  }
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

    window.addEventListener('online', requestSync);
    window.addEventListener('shopkeeper:sync-requested', requestSync);
    return () => {
      window.removeEventListener('online', requestSync);
      window.removeEventListener('shopkeeper:sync-requested', requestSync);
    };
  }, [user?.uid]);

  return <>{children}</>;
}

'use client';

import { useEffect } from 'react';
import { db } from '@/lib/db/schema';
import { nowIso } from '@/lib/utils/date';
import { syncBillToCloud, syncProductsToCloud } from '@/lib/firebase/sync-service';
import {
  getPendingSyncJobs,
  markSyncing,
  markSynced,
  markFailed,
} from '@/lib/services/sync-queue-service';
import { useAuth } from './auth-context';
import type { SyncQueueItem } from '@/types/domain';

const MAX_RETRIES = 5;

async function processJob(uid: string, job: SyncQueueItem): Promise<void> {
  if ((job.retryCount ?? 0) >= MAX_RETRIES) return;

  await markSyncing(job.id);
  try {
    if (job.entity === 'bill') {
      const [bill, items] = await Promise.all([
        db.bills.get(job.entityId),
        db.billItems.where('billId').equals(job.entityId).toArray(),
      ]);
      if (!bill) {
        // Entity was deleted locally — nothing to sync
        await markSynced(job.id);
        return;
      }
      await syncBillToCloud(uid, bill, items);
      await db.bills.update(job.entityId, { syncStatus: 'synced', syncedAt: nowIso(), lastSyncError: undefined });
    } else if (job.entity === 'product') {
      const product = await db.products.get(job.entityId);
      if (!product) {
        await markSynced(job.id);
        return;
      }
      await syncProductsToCloud(uid, [product]);
      await db.products.update(job.entityId, { syncStatus: 'synced', syncedAt: nowIso(), lastSyncError: undefined });
    }
    await markSynced(job.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markFailed(job.id, msg);
    if (job.entity === 'bill') {
      await db.bills.update(job.entityId, { syncStatus: 'failed', lastSyncError: msg });
    } else if (job.entity === 'product') {
      await db.products.update(job.entityId, { syncStatus: 'failed', lastSyncError: msg });
    }
  }
}

async function runSync(uid: string): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const jobs = await getPendingSyncJobs();
  for (const job of jobs) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) break;
    await processJob(uid, job);
  }
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.uid) return;
    const uid = user.uid;

    void runSync(uid);

    const onOnline = () => void runSync(uid);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [user?.uid]);

  return <>{children}</>;
}

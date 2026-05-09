import { db } from '@/lib/db/schema';
import { nowIso } from '@/lib/utils/date';
import { createId } from '@/lib/utils/id';
import type { SyncEntity, SyncOperation, SyncQueueItem } from '@/types/domain';

export async function enqueueSyncJob(input: {
  entity: SyncEntity;
  entityId: string;
  operation: SyncOperation;
}): Promise<string> {
  const id = createId('sq');
  const now = nowIso();
  const item: SyncQueueItem = {
    id,
    entity: input.entity,
    entityId: input.entityId,
    operation: input.operation,
    status: 'pending',
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.syncQueue.add(item);
  return id;
}

export async function getPendingSyncJobs(): Promise<SyncQueueItem[]> {
  // Re-queue items that got stuck in 'syncing' (e.g. app crashed mid-sync)
  await db.syncQueue.where('status').equals('syncing').modify({ status: 'pending' });
  return db.syncQueue
    .where('status')
    .anyOf(['pending', 'failed'])
    .toArray();
}

export async function markSyncing(id: string): Promise<void> {
  const now = nowIso();
  await db.syncQueue.update(id, { status: 'syncing', updatedAt: now, lastAttemptAt: now });
}

export async function markSynced(id: string): Promise<void> {
  const now = nowIso();
  await db.syncQueue.update(id, { status: 'synced', updatedAt: now, syncedAt: now });
}

export async function markFailed(id: string, error: string): Promise<void> {
  const item = await db.syncQueue.get(id);
  if (!item) return;
  await db.syncQueue.update(id, {
    status: 'failed',
    updatedAt: nowIso(),
    retryCount: (item.retryCount ?? 0) + 1,
    lastError: error.slice(0, 500),
  });
}

export async function getPendingSyncCount(): Promise<number> {
  return db.syncQueue.where('status').anyOf(['pending', 'failed']).count();
}

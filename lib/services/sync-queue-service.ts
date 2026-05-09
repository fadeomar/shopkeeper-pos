import { db } from '@/lib/db/schema';
import { nowIso } from '@/lib/utils/date';
import type { SyncEntity, SyncOperation, SyncQueueItem } from '@/types/domain';

export function getSyncQueueId(entity: SyncEntity, entityId: string): string {
  return `sq:${entity}:${entityId}`;
}

function notifySyncRequested(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('shopkeeper:sync-requested'));
}

export function buildSyncQueueItem(
  input: {
    entity: SyncEntity;
    entityId: string;
    operation: SyncOperation;
    payload?: unknown;
  },
  existing?: SyncQueueItem,
): SyncQueueItem {
  const now = nowIso();
  return {
    id: getSyncQueueId(input.entity, input.entityId),
    entity: input.entity,
    entityId: input.entityId,
    operation: input.operation,
    payload: input.payload,
    status: 'pending',
    // A new local change should get a fresh retry budget even if an earlier sync failed.
    retryCount: 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastError: undefined,
    lastAttemptAt: existing?.lastAttemptAt,
    syncedAt: undefined,
  };
}

export async function enqueueSyncJob(input: {
  entity: SyncEntity;
  entityId: string;
  operation: SyncOperation;
  payload?: unknown;
}): Promise<string> {
  const id = getSyncQueueId(input.entity, input.entityId);
  const existing = await db.syncQueue.get(id);
  await db.syncQueue.put(buildSyncQueueItem(input, existing));
  notifySyncRequested();
  return id;
}

export async function getPendingSyncJobs(): Promise<SyncQueueItem[]> {
  // Re-queue items that got stuck in 'syncing' (for example, app/tab crashed mid-sync).
  await db.syncQueue.where('status').equals('syncing').modify({ status: 'pending', updatedAt: nowIso() });
  const jobs = await db.syncQueue
    .where('status')
    .anyOf(['pending', 'failed'])
    .toArray();

  return jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function markSyncing(id: string): Promise<void> {
  const now = nowIso();
  await db.syncQueue.update(id, {
    status: 'syncing',
    updatedAt: now,
    lastAttemptAt: now,
    lastError: undefined,
  });
}

export async function markSynced(id: string): Promise<void> {
  const now = nowIso();
  await db.syncQueue.update(id, {
    status: 'synced',
    updatedAt: now,
    syncedAt: now,
    lastError: undefined,
  });
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
  return db.syncQueue.where('status').anyOf(['pending', 'failed', 'syncing']).count();
}

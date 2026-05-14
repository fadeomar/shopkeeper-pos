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

const SYNC_ENTITY_PRIORITY: Record<SyncEntity, number> = {
  // Customers must push BEFORE bills that reference them, otherwise a fresh
  // device pulling the bill would see customerId pointing at nothing.
  customer: 0,
  // Bills then sync their bill items, stock movements, and sale-driven
  // product stock. Keep them ahead of manual product writes so an offline
  // sale does not look like a manual product overwrite.
  bill: 1,
  customerPayment: 2,
  stockMovement: 3,
  product: 4,
  settings: 5,
};

export async function getPendingSyncJobs(): Promise<SyncQueueItem[]> {
  // Re-queue items that got stuck in 'syncing' (for example, app/tab crashed mid-sync).
  await db.syncQueue.where('status').equals('syncing').modify({ status: 'pending', updatedAt: nowIso() });
  const jobs = await db.syncQueue
    .where('status')
    .anyOf(['pending', 'failed'])
    .toArray();

  return jobs.sort((a, b) => {
    const byPriority = SYNC_ENTITY_PRIORITY[a.entity] - SYNC_ENTITY_PRIORITY[b.entity];
    if (byPriority !== 0) return byPriority;
    const byCreatedAt = a.createdAt.localeCompare(b.createdAt);
    return byCreatedAt !== 0 ? byCreatedAt : a.id.localeCompare(b.id);
  });
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

export async function markBlocked(id: string, error: string): Promise<void> {
  await db.syncQueue.update(id, {
    status: 'blocked',
    updatedAt: nowIso(),
    lastError: error.slice(0, 500),
  });
}


export async function markConflict(id: string, error = 'Needs conflict review'): Promise<void> {
  await db.syncQueue.update(id, {
    status: 'conflict',
    updatedAt: nowIso(),
    lastError: error.slice(0, 500),
  });
}

export async function getPendingSyncCount(): Promise<number> {
  return db.syncQueue.where('status').anyOf(['pending', 'failed', 'syncing', 'conflict', 'blocked']).count();
}

export async function retryFailedSyncJobs(): Promise<number> {
  const now = nowIso();
  // Manual retry also picks up blocked jobs (the ones that exhausted MAX_RETRIES).
  // Resetting retryCount gives them a fresh budget after the user investigated.
  const recoverableJobs = await db.syncQueue
    .where('status')
    .anyOf(['failed', 'blocked'])
    .toArray();
  await Promise.all(
    recoverableJobs.map((job) =>
      db.syncQueue.update(job.id, {
        status: 'pending',
        retryCount: 0,
        lastError: undefined,
        updatedAt: now,
      }),
    ),
  );
  if (recoverableJobs.length > 0) notifySyncRequested();
  return recoverableJobs.length;
}

export async function getSyncQueueCounts(): Promise<{
  pending: number;
  syncing: number;
  failed: number;
  conflict: number;
  blocked: number;
  synced: number;
}> {
  const [pending, syncing, failed, conflict, blocked, synced] = await Promise.all([
    db.syncQueue.where('status').equals('pending').count(),
    db.syncQueue.where('status').equals('syncing').count(),
    db.syncQueue.where('status').equals('failed').count(),
    db.syncQueue.where('status').equals('conflict').count(),
    db.syncQueue.where('status').equals('blocked').count(),
    db.syncQueue.where('status').equals('synced').count(),
  ]);
  return { pending, syncing, failed, conflict, blocked, synced };
}

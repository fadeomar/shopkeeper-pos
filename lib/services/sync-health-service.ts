import { db } from '@/lib/db/schema';
import type { SyncEntity, SyncQueueItem, SyncStatus } from '@/types/domain';

const ACTIONABLE_STATUSES: SyncStatus[] = ['pending', 'syncing', 'failed', 'conflict', 'blocked'];
const STALE_SYNCING_MS = 2 * 60_000;

export interface SyncQueueHealthDetails {
  oldestWaitingAt?: string;
  oldestWaitingLabel?: string;
  recentProblems: Array<{
    id: string;
    entity: SyncEntity;
    entityId: string;
    status: SyncStatus;
    retryCount: number;
    updatedAt: string;
    lastError?: string;
  }>;
  staleSyncing: number;
}

function displayEntity(entity: SyncEntity): string {
  return entity.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function queueSort(a: SyncQueueItem, b: SyncQueueItem): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export async function requeueStaleSyncingJobs(maxAgeMs = STALE_SYNCING_MS): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  const syncingJobs = await db.syncQueue.where('status').equals('syncing').toArray();
  const staleJobs = syncingJobs.filter((job) => {
    const last = Date.parse(job.lastAttemptAt ?? job.updatedAt ?? job.createdAt);
    return Number.isFinite(last) && last < cutoff;
  });

  if (staleJobs.length === 0) return 0;

  const now = new Date().toISOString();
  await Promise.all(
    staleJobs.map((job) =>
      db.syncQueue.update(job.id, {
        status: 'pending',
        updatedAt: now,
        lastError: undefined,
      }),
    ),
  );

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('shopkeeper:sync-requested'));
  }

  return staleJobs.length;
}

export async function getSyncQueueHealthDetails(): Promise<SyncQueueHealthDetails> {
  const jobs = await db.syncQueue.where('status').anyOf(ACTIONABLE_STATUSES).toArray();
  const sorted = jobs.sort(queueSort);
  const oldest = sorted[0];
  const now = Date.now();
  const staleSyncing = jobs.filter((job) => {
    if (job.status !== 'syncing') return false;
    const last = Date.parse(job.lastAttemptAt ?? job.updatedAt ?? job.createdAt);
    return Number.isFinite(last) && now - last > STALE_SYNCING_MS;
  }).length;

  const recentProblems = jobs
    .filter((job) => job.status === 'failed' || job.status === 'blocked' || job.status === 'conflict')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)
    .map((job) => ({
      id: job.id,
      entity: job.entity,
      entityId: job.entityId,
      status: job.status,
      retryCount: job.retryCount ?? 0,
      updatedAt: job.updatedAt,
      lastError: job.lastError,
    }));

  return {
    oldestWaitingAt: oldest?.createdAt,
    oldestWaitingLabel: oldest ? `${displayEntity(oldest.entity)} · ${oldest.status}` : undefined,
    recentProblems,
    staleSyncing,
  };
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/schema';
import {
  getSyncQueueHealthDetails,
  requeueStaleSyncingJobs,
} from '@/lib/services/sync-health-service';
import { resetTestDb } from '@/tests/helpers/db';
import type { SyncEntity, SyncQueueItem } from '@/types/domain';

function makeJob(entity: SyncEntity, entityId: string, overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
  const baseAt = overrides.createdAt ?? '2026-01-01T00:00:00.000Z';
  return {
    id: `sq:${entity}:${entityId}`,
    entity,
    entityId,
    operation: 'upsert',
    status: 'pending',
    retryCount: 0,
    createdAt: baseAt,
    updatedAt: overrides.updatedAt ?? baseAt,
    ...overrides,
  };
}

describe('sync-health-service integration', () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.restoreAllMocks();
  });

  it('surfaces the oldest actionable sync job and recent problem jobs for Device Health', async () => {
    await db.syncQueue.bulkPut([
      makeJob('product', 'synced-1', { status: 'synced', createdAt: '2026-01-01T00:00:00.000Z' }),
      makeJob('bill', 'bill-1', { status: 'pending', createdAt: '2026-01-01T00:00:01.000Z' }),
      makeJob('purchase', 'purchase-1', { status: 'failed', lastError: 'network down', retryCount: 2, createdAt: '2026-01-01T00:00:02.000Z', updatedAt: '2026-01-01T00:00:04.000Z' }),
      makeJob('settings', 'app-settings', { status: 'blocked', lastError: 'permission denied', createdAt: '2026-01-01T00:00:03.000Z', updatedAt: '2026-01-01T00:00:05.000Z' }),
    ]);

    const health = await getSyncQueueHealthDetails();

    expect(health.oldestWaitingAt).toBe('2026-01-01T00:00:01.000Z');
    expect(health.oldestWaitingLabel).toBe('bill · pending');
    expect(health.recentProblems.map((job) => [job.entity, job.status, job.lastError])).toEqual([
      ['settings', 'blocked', 'permission denied'],
      ['purchase', 'failed', 'network down'],
    ]);
  });

  it('requeues stale syncing jobs without touching fresh syncing or synced jobs', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-01T00:10:00.000Z'));
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    await db.syncQueue.bulkPut([
      makeJob('bill', 'stale', {
        status: 'syncing',
        lastAttemptAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastError: 'tab crashed',
      }),
      makeJob('purchase', 'fresh', {
        status: 'syncing',
        lastAttemptAt: '2026-01-01T00:09:30.000Z',
        updatedAt: '2026-01-01T00:09:30.000Z',
      }),
      makeJob('product', 'synced', { status: 'synced' }),
    ]);

    await expect(requeueStaleSyncingJobs()).resolves.toBe(1);
    const staleJob = await db.syncQueue.get('sq:bill:stale');
    expect(staleJob).toMatchObject({ status: 'pending' });
    expect(staleJob).not.toHaveProperty('lastError');
    await expect(db.syncQueue.get('sq:purchase:fresh')).resolves.toMatchObject({ status: 'syncing' });
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'shopkeeper:sync-requested' }));

  });
});

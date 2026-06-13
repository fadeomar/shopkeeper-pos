import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db/schema';
import {
  buildSyncQueueItem,
  enqueueSyncJob,
  getPendingSyncCount,
  getPendingSyncJobs,
  getSyncQueueCounts,
  markBlocked,
  markFailed,
  markSynced,
  markSyncing,
  retryFailedSyncJobs,
} from '@/lib/services/sync-queue-service';
import { resetTestDb } from '@/tests/helpers/db';
import type { SyncEntity, SyncQueueItem } from '@/types/domain';

function makeJob(entity: SyncEntity, entityId: string, overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
  return {
    ...buildSyncQueueItem({ entity, entityId, operation: overrides.operation ?? 'upsert' }),
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('sync-queue-service integration', () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it('deduplicates entity jobs while preserving original creation time and refreshing retry budget', async () => {
    const firstId = await enqueueSyncJob({ entity: 'product', entityId: 'product-1', operation: 'create' });
    await markFailed(firstId, 'network down');
    const failed = await db.syncQueue.get(firstId);

    const secondId = await enqueueSyncJob({ entity: 'product', entityId: 'product-1', operation: 'upsert' });
    const latest = await db.syncQueue.get(secondId);

    expect(firstId).toBe('sq:product:product-1');
    expect(secondId).toBe(firstId);
    expect(latest).toMatchObject({
      id: firstId,
      entity: 'product',
      entityId: 'product-1',
      operation: 'upsert',
      status: 'pending',
      retryCount: 0,
      lastError: undefined,
    });
    expect(latest?.createdAt).toBe(failed?.createdAt);
    expect(latest?.updatedAt).not.toBe(failed?.updatedAt);
  });

  it('orders pending and failed jobs by dependency priority before creation time', async () => {
    await db.syncQueue.bulkPut([
      makeJob('bill', 'bill-1', { createdAt: '2026-01-01T00:00:02.000Z' }),
      makeJob('supplierPayment', 'supp-pay-1', { createdAt: '2026-01-01T00:00:01.000Z', status: 'failed' }),
      makeJob('customer', 'cust-1', { createdAt: '2026-01-01T00:00:09.000Z' }),
      makeJob('shift', 'shift-1', { createdAt: '2026-01-01T00:00:04.000Z' }),
      makeJob('purchase', 'purchase-1', { createdAt: '2026-01-01T00:00:03.000Z' }),
      makeJob('settings', 'app-settings', { createdAt: '2026-01-01T00:00:00.000Z' }),
      makeJob('product', 'product-1', { createdAt: '2026-01-01T00:00:00.000Z' }),
      makeJob('expense', 'expense-1', { createdAt: '2026-01-01T00:00:00.000Z' }),
    ]);

    const ordered = await getPendingSyncJobs();
    expect(ordered.map((job) => job.entity)).toEqual([
      'customer',
      'shift',
      'bill',
      'purchase',
      'supplierPayment',
      'settings',
      'product',
      'expense',
    ]);
  });

  it('requeues stuck syncing jobs when pending jobs are requested', async () => {
    await db.syncQueue.bulkPut([
      makeJob('bill', 'bill-1', { status: 'syncing' }),
      makeJob('product', 'product-1', { status: 'synced' }),
    ]);

    const jobs = await getPendingSyncJobs();
    expect(jobs.map((job) => [job.entity, job.status])).toEqual([['bill', 'pending']]);
    await expect(db.syncQueue.get('sq:bill:bill-1')).resolves.toMatchObject({ status: 'pending' });
  });

  it('tracks lifecycle counts and lets manual retry recover failed and blocked jobs', async () => {
    await db.syncQueue.bulkPut([
      makeJob('bill', 'bill-1'),
      makeJob('product', 'product-1'),
      makeJob('settings', 'settings-1'),
      makeJob('auditEvent', 'audit-1', { status: 'conflict' }),
    ]);

    await markSyncing('sq:bill:bill-1');
    await markSynced('sq:product:product-1');
    await markFailed('sq:settings:settings-1', 'permission denied');
    await markFailed('sq:settings:settings-1', 'permission denied again');
    await markBlocked('sq:settings:settings-1', 'max retries exceeded');

    await expect(db.syncQueue.get('sq:bill:bill-1')).resolves.toMatchObject({
      status: 'syncing',
      lastAttemptAt: expect.any(String),
    });
    await expect(db.syncQueue.get('sq:product:product-1')).resolves.toMatchObject({
      status: 'synced',
      syncedAt: expect.any(String),
    });
    await expect(db.syncQueue.get('sq:settings:settings-1')).resolves.toMatchObject({
      status: 'blocked',
      retryCount: 2,
      lastError: 'max retries exceeded',
    });
    await expect(getSyncQueueCounts()).resolves.toMatchObject({
      pending: 0,
      syncing: 1,
      failed: 0,
      conflict: 1,
      blocked: 1,
      synced: 1,
    });
    await expect(getPendingSyncCount()).resolves.toBe(3);

    const retried = await retryFailedSyncJobs();
    expect(retried).toBe(1);
    const retriedJob = await db.syncQueue.get('sq:settings:settings-1');
    expect(retriedJob).toMatchObject({
      status: 'pending',
      retryCount: 0,
    });
    expect(retriedJob?.lastError).toBeUndefined();
  });
});

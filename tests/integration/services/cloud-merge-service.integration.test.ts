import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/schema';
import { makeProduct, makeSettings } from '@/tests/helpers/builders';
import { resetTestDb } from '@/tests/helpers/db';
import type { Product, SyncQueueItem } from '@/types/domain';

// Firestore reads are stubbed so the merge/conflict logic can be exercised
// without a real project. saveConflict still runs against fake-indexeddb so we
// assert the durable conflict rows it produces.
const { getDocMock, getDocsMock } = vi.hoisted(() => ({
  getDocMock: vi.fn(),
  getDocsMock: vi.fn(),
}));

vi.mock('@/lib/firebase/config', () => ({ firestore: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_fs: unknown, path: string) => ({ path }),
  collection: (_fs: unknown, path: string) => ({ path }),
  query: (...parts: unknown[]) => ({ parts }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  limit: (n: number) => ({ limit: n }),
  getDoc: (ref: unknown) => getDocMock(ref),
  getDocs: (ref: unknown) => getDocsMock(ref),
}));

const { detectProductCloudConflict, prepareSettingsForCloudSync } = await import('@/lib/firebase/cloud-merge-service');

function snap(data: Record<string, unknown> | null) {
  return { exists: () => data !== null, data: () => data ?? undefined };
}

function makeJob(overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
  return {
    id: 'job-1',
    entity: 'product',
    entityId: 'product-1',
    operation: 'update',
    status: 'pending',
    retryCount: 0,
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2025-12-01T00:00:00.000Z',
    ...overrides,
  } as SyncQueueItem;
}

const OLDER = '2026-01-01T00:00:00.000Z';
const NEWER = '2026-02-01T00:00:00.000Z';

describe('cloud-merge-service', () => {
  beforeEach(async () => {
    await resetTestDb();
    getDocMock.mockReset();
    getDocsMock.mockReset();
    getDocsMock.mockResolvedValue({ docs: [] });
  });

  describe('detectProductCloudConflict', () => {
    it('raises a same-field conflict when a newer cloud copy changed a business field', async () => {
      const base = makeProduct({ id: 'product-1', barcode: '111', name: 'Base' });
      const local: Product = { ...base, name: 'Local name', syncedAt: OLDER };
      const cloud: Product = { ...base, name: 'Cloud name', syncedAt: NEWER };
      getDocMock.mockResolvedValueOnce(snap(cloud as unknown as Record<string, unknown>));

      const result = await detectProductCloudConflict('uid-1', local, makeJob());

      expect(result.hasConflict).toBe(true);
      await expect(db.syncConflicts.get(result.conflictId!)).resolves.toMatchObject({
        entity: 'product',
        conflictType: 'same_field_changed',
        severity: 'medium',
        changedFields: ['name'],
      });
    });

    it('escalates to high severity when the changed field is quantityInStock', async () => {
      const base = makeProduct({ id: 'product-1', barcode: '111', quantityInStock: 5 });
      const local: Product = { ...base, quantityInStock: 3, syncedAt: OLDER };
      const cloud: Product = { ...base, quantityInStock: 9, syncedAt: NEWER };
      getDocMock.mockResolvedValueOnce(snap(cloud as unknown as Record<string, unknown>));

      const result = await detectProductCloudConflict('uid-1', local, makeJob());

      await expect(db.syncConflicts.get(result.conflictId!)).resolves.toMatchObject({
        severity: 'high',
        changedFields: ['quantityInStock'],
      });
    });

    it('does not raise a conflict when the local copy is newer than the cloud', async () => {
      const base = makeProduct({ id: 'product-1', barcode: '111' });
      const local: Product = { ...base, name: 'Local name', syncedAt: NEWER };
      const cloud: Product = { ...base, name: 'Cloud name', syncedAt: OLDER };
      getDocMock.mockResolvedValueOnce(snap(cloud as unknown as Record<string, unknown>));

      const result = await detectProductCloudConflict('uid-1', local, makeJob());

      expect(result.hasConflict).toBe(false);
      await expect(db.syncConflicts.count()).resolves.toBe(0);
    });

    it('raises a duplicate-record conflict when another cloud product owns the same barcode', async () => {
      const local = makeProduct({ id: 'product-1', barcode: '111', syncedAt: OLDER });
      const duplicate = makeProduct({ id: 'product-2', barcode: '111', name: 'Other product' });
      getDocMock.mockResolvedValueOnce(snap(null)); // no same-id doc in cloud
      getDocsMock.mockResolvedValueOnce({ docs: [{ data: () => duplicate }] });

      const result = await detectProductCloudConflict('uid-1', local, makeJob());

      expect(result.hasConflict).toBe(true);
      await expect(db.syncConflicts.get(result.conflictId!)).resolves.toMatchObject({
        conflictType: 'duplicate_record',
        severity: 'high',
        changedFields: ['barcode'],
      });
    });

    it('is conflict-free when no same-id doc and no barcode duplicate exist', async () => {
      const local = makeProduct({ id: 'product-1', barcode: '111', syncedAt: OLDER });
      getDocMock.mockResolvedValueOnce(snap(null));

      const result = await detectProductCloudConflict('uid-1', local, makeJob());

      expect(result.hasConflict).toBe(false);
      await expect(db.syncConflicts.count()).resolves.toBe(0);
    });
  });

  describe('prepareSettingsForCloudSync', () => {
    const settingsJob = makeJob({ entity: 'settings', entityId: 'app-settings' });

    it('returns the local settings untouched when no cloud doc exists yet', async () => {
      const settings = makeSettings();
      getDocMock.mockResolvedValueOnce(snap(null));

      const result = await prepareSettingsForCloudSync('uid-1', settings, settingsJob);

      expect(result.hasConflict).toBe(false);
      expect(result.settings).toBe(settings);
    });

    it('max-merges the monotonic counters without raising a conflict for sequence-only drift', async () => {
      const local = makeSettings({ nextBillSequence: 5, nextPurchaseSequence: 2, syncedAt: OLDER });
      const cloud = makeSettings({ nextBillSequence: 9, nextPurchaseSequence: 1, syncedAt: NEWER });
      getDocMock.mockResolvedValueOnce(snap(cloud as unknown as Record<string, unknown>));

      const result = await prepareSettingsForCloudSync('uid-1', local, settingsJob);

      expect(result.hasConflict).toBe(false);
      expect(result.settings.nextBillSequence).toBe(9);
      expect(result.settings.nextPurchaseSequence).toBe(2);
      await expect(db.syncConflicts.count()).resolves.toBe(0);
    });

    it('raises a high-severity conflict when a newer cloud copy changed a business field', async () => {
      const local = makeSettings({ storeName: 'Local Store', syncedAt: OLDER });
      const cloud = makeSettings({ storeName: 'Cloud Store', syncedAt: NEWER });
      getDocMock.mockResolvedValueOnce(snap(cloud as unknown as Record<string, unknown>));

      const result = await prepareSettingsForCloudSync('uid-1', local, settingsJob);

      expect(result.hasConflict).toBe(true);
      await expect(db.syncConflicts.get(result.conflictId!)).resolves.toMatchObject({
        entity: 'settings',
        conflictType: 'settings_conflict',
        severity: 'high',
        changedFields: ['storeName'],
      });
    });

    it('escalates to critical severity when the currency differs', async () => {
      const local = makeSettings({ currency: 'ILS', syncedAt: OLDER });
      const cloud = makeSettings({ currency: 'USD', syncedAt: NEWER });
      getDocMock.mockResolvedValueOnce(snap(cloud as unknown as Record<string, unknown>));

      const result = await prepareSettingsForCloudSync('uid-1', local, settingsJob);

      await expect(db.syncConflicts.get(result.conflictId!)).resolves.toMatchObject({ severity: 'critical' });
    });
  });
});

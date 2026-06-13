import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/schema';
import { makeSettings } from '@/tests/helpers/builders';
import { resetTestDb, seedProduct, seedSettings } from '@/tests/helpers/db';
import type { Bill } from '@/types/domain';

const { getDocsMock, getDocMock, setDocMock } = vi.hoisted(() => ({
  getDocsMock: vi.fn(),
  getDocMock: vi.fn(),
  setDocMock: vi.fn(),
}));

vi.mock('@/lib/firebase/config', () => ({ firestore: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_fs: unknown, path: string) => ({ path }),
  doc: (_fs: unknown, path: string) => ({ path }),
  getDocs: (ref: unknown) => getDocsMock(ref),
  getDoc: (ref: unknown) => getDocMock(ref),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  writeBatch: () => ({ set() {}, delete() {}, commit: () => Promise.resolve() }),
}));

const {
  getRestoreErrorMessage,
  isLocalDbEmpty,
  fetchSyncMeta,
  pullSettingsFromCloud,
  restoreFromCloud,
  RestoreError,
} = await import('@/lib/firebase/restore-service');

type CloudDoc = { id: string; body: object };

function setCloud(map: Record<string, CloudDoc[]>): void {
  getDocsMock.mockImplementation((ref: { path: string }) => {
    const name = ref.path.split('/').pop() ?? '';
    const rows = map[name] ?? [];
    return Promise.resolve({
      empty: rows.length === 0,
      docs: rows.map((r) => ({ id: r.id, data: () => r.body })),
    });
  });
}

function makeBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 'bill-1',
    billNumber: 'INV-000001',
    createdAt: '2026-01-10T10:00:00.000Z',
    cashierName: 'Cashier',
    paymentMethod: 'cash',
    subtotal: 100,
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 100,
    paidAmount: 100,
    changeAmount: 0,
    cashAmount: 100,
    cardAmount: 0,
    creditAmount: 0,
    totalProfit: 30,
    itemCount: 2,
    status: 'finalized',
    ...overrides,
  };
}

describe('getRestoreErrorMessage', () => {
  it('maps known Firestore error codes to actionable messages', () => {
    expect(getRestoreErrorMessage({ code: 'permission-denied' })).toMatch(/permission/i);
    expect(getRestoreErrorMessage({ code: 'unavailable' })).toMatch(/temporarily unavailable/i);
    expect(getRestoreErrorMessage({ code: 'unauthenticated' })).toMatch(/sign in again/i);
  });

  it('passes through a RestoreError message and falls back for unknown errors', () => {
    expect(getRestoreErrorMessage(new RestoreError('Custom restore failure'))).toBe('Custom restore failure');
    expect(getRestoreErrorMessage(new Error('boom'))).toMatch(/check your connection/i);
  });
});

describe('isLocalDbEmpty', () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it('is true on a fresh database', async () => {
    await expect(isLocalDbEmpty()).resolves.toBe(true);
  });

  it('is false once any business table has a row (even a non-bill table)', async () => {
    await db.customers.put({ id: 'c1', name: 'Ali', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', syncStatus: 'synced' });
    await expect(isLocalDbEmpty()).resolves.toBe(false);
  });
});

describe('fetchSyncMeta', () => {
  beforeEach(() => {
    getDocMock.mockReset();
  });

  it('returns the meta document when it exists', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => true, data: () => ({ lastSyncedAt: '2026-02-01T00:00:00.000Z', recordCounts: {} }) });
    await expect(fetchSyncMeta('uid-1')).resolves.toMatchObject({ lastSyncedAt: '2026-02-01T00:00:00.000Z' });
  });

  it('returns null when the meta document is missing', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    await expect(fetchSyncMeta('uid-1')).resolves.toBeNull();
  });

  it('returns null instead of throwing when the read fails (offline)', async () => {
    getDocMock.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchSyncMeta('uid-1')).resolves.toBeNull();
  });
});

describe('pullSettingsFromCloud', () => {
  beforeEach(async () => {
    await resetTestDb();
    getDocsMock.mockReset();
  });

  it('returns null when there is no cloud settings doc', async () => {
    setCloud({ settings: [] });
    await expect(pullSettingsFromCloud('uid-1')).resolves.toBeNull();
  });

  it('overwrites local with a newer cloud copy while max-merging the sequence counters', async () => {
    await seedSettings({ storeName: 'Local', updatedAt: '2026-01-01T00:00:00.000Z', nextBillSequence: 20 });
    setCloud({ settings: [{ id: 'app-settings', body: makeSettings({ storeName: 'Cloud', updatedAt: '2026-03-01T00:00:00.000Z', nextBillSequence: 5 }) }] });

    const result = await pullSettingsFromCloud('uid-1');

    expect(result).toMatchObject({ storeName: 'Cloud', nextBillSequence: 20 });
    await expect(db.settings.get('app-settings')).resolves.toMatchObject({ storeName: 'Cloud', nextBillSequence: 20 });
  });

  it('skips the pull when the device has a pending settings push', async () => {
    await seedSettings({ storeName: 'Local', updatedAt: '2026-01-01T00:00:00.000Z' });
    await db.syncQueue.put({ id: 'sq:settings:app-settings', entity: 'settings', entityId: 'app-settings', operation: 'upsert', status: 'pending', retryCount: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    setCloud({ settings: [{ id: 'app-settings', body: makeSettings({ storeName: 'Cloud', updatedAt: '2026-03-01T00:00:00.000Z' }) }] });

    await expect(pullSettingsFromCloud('uid-1')).resolves.toBeNull();
    await expect(db.settings.get('app-settings')).resolves.toMatchObject({ storeName: 'Local' });
  });
});

describe('restoreFromCloud', () => {
  beforeEach(async () => {
    await resetTestDb();
    getDocsMock.mockReset();
    setCloud({});
  });

  it('replaces stale local data with the cloud backup and bumps sequences past the restored bills', async () => {
    await seedProduct({ id: 'stale-local', name: 'Should be wiped' });
    setCloud({
      products: [{ id: 'p1', body: { id: 'p1', name: 'Cloud Product', barcode: '1', category: 'C', unit: 'pcs', quantityInStock: 5, buyPrice: 2, sellPrice: 5, status: 'active', dateAdded: '2026-01-01T00:00:00.000Z', lastUpdated: '2026-01-01T00:00:00.000Z' } }],
      bills: [{ id: 'b1', body: makeBill({ id: 'b1', billNumber: 'INV-000007' }) as unknown as Record<string, unknown> }],
      settings: [{ id: 'app-settings', body: makeSettings({ nextBillSequence: 2 }) }],
    });

    await restoreFromCloud('uid-1');

    await expect(db.products.get('stale-local')).resolves.toBeUndefined();
    await expect(db.products.get('p1')).resolves.toMatchObject({ name: 'Cloud Product', syncStatus: 'synced' });
    await expect(db.bills.get('b1')).resolves.toMatchObject({ billNumber: 'INV-000007' });
    // ensureRestoredSettings: max(local 2, maxBillSeq 7 + 1) = 8.
    await expect(db.settings.get('app-settings')).resolves.toMatchObject({ nextBillSequence: 8 });
  });

  it('regenerates duplicate bill numbers so a restore never reissues the same INV number', async () => {
    setCloud({
      bills: [
        { id: 'b1', body: makeBill({ id: 'b1', billNumber: 'INV-000005', createdAt: '2026-01-10T08:00:00.000Z' }) as unknown as Record<string, unknown> },
        { id: 'b2', body: makeBill({ id: 'b2', billNumber: 'INV-000005', createdAt: '2026-01-10T09:00:00.000Z' }) as unknown as Record<string, unknown> },
      ],
    });

    await restoreFromCloud('uid-1');

    const b1 = await db.bills.get('b1');
    const b2 = await db.bills.get('b2');
    expect(b1?.billNumber).not.toBe(b2?.billNumber);
    // The later-created duplicate is the one repaired, with a traceable note.
    expect(b2?.notes).toMatch(/Restored from cloud backup/i);
  });

  it('seeds default settings whose sequence clears the restored bills when the cloud has none', async () => {
    setCloud({
      bills: [{ id: 'b1', body: makeBill({ id: 'b1', billNumber: 'INV-000050' }) as unknown as Record<string, unknown> }],
      settings: [],
    });

    await restoreFromCloud('uid-1');

    await expect(db.settings.get('app-settings')).resolves.toMatchObject({ nextBillSequence: 51, syncStatus: 'synced' });
  });

  it('synthesizes an opening lot for legacy products that have stock but no lots, and queues it for sync', async () => {
    // Pre-FIFO cloud backup: a product with stock but no inventoryLots.
    setCloud({
      products: [{ id: 'legacy-1', body: { id: 'legacy-1', name: 'Legacy Rice', barcode: '111', category: 'C', unit: 'pcs', quantityInStock: 40, buyPrice: 3, sellPrice: 6, status: 'active', dateAdded: '2026-01-01T00:00:00.000Z', lastUpdated: '2026-01-01T00:00:00.000Z' } }],
    });

    await restoreFromCloud('uid-1');

    const lots = await db.inventoryLots.where('productId').equals('legacy-1').toArray();
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({
      sourceType: 'opening_balance',
      sourceId: 'legacy-opening-restore',
      quantityReceived: 40,
      quantityRemaining: 40,
      unitCost: 3,
      status: 'open',
      syncStatus: 'pending',
    });
    // The new lot is queued so it reaches the cloud (restored rows are 'synced').
    await expect(db.syncQueue.get(`sq:inventoryLot:${lots[0].id}`)).resolves.toMatchObject({
      entity: 'inventoryLot',
      operation: 'create',
      status: 'pending',
    });
  });

  it('does not duplicate the opening lot when a later restore already pulls it back (idempotent)', async () => {
    setCloud({
      products: [{ id: 'legacy-1', body: { id: 'legacy-1', name: 'Legacy Rice', barcode: '111', category: 'C', unit: 'pcs', quantityInStock: 40, buyPrice: 3, sellPrice: 6, status: 'active', dateAdded: '2026-01-01T00:00:00.000Z', lastUpdated: '2026-01-01T00:00:00.000Z' } }],
    });
    await restoreFromCloud('uid-1');
    const firstLot = (await db.inventoryLots.where('productId').equals('legacy-1').toArray())[0];

    // Simulate the synthesized lot having been pushed to the cloud, so the next
    // restore pulls it back. The product now has a lot → no second one created.
    setCloud({
      products: [{ id: 'legacy-1', body: { id: 'legacy-1', name: 'Legacy Rice', barcode: '111', category: 'C', unit: 'pcs', quantityInStock: 40, buyPrice: 3, sellPrice: 6, status: 'active', dateAdded: '2026-01-01T00:00:00.000Z', lastUpdated: '2026-01-01T00:00:00.000Z' } }],
      inventoryLots: [{ id: firstLot.id, body: firstLot as unknown as Record<string, unknown> }],
    });

    await restoreFromCloud('uid-1');

    const lots = await db.inventoryLots.where('productId').equals('legacy-1').toArray();
    expect(lots).toHaveLength(1);
    expect(lots[0].id).toBe(firstLot.id);
  });
});

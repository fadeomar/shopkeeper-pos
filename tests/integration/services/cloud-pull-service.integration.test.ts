import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/schema';
import { getSyncQueueId } from '@/lib/services/sync-queue-service';
import { makeProduct, makeSettings } from '@/tests/helpers/builders';
import { resetTestDb, seedProduct, seedSettings } from '@/tests/helpers/db';
import type { Bill } from '@/types/domain';

// Firestore reads are stubbed and routed by collection path; everything else
// (Dexie, saveConflict, sequence merge) runs for real against fake-indexeddb.
const { getDocsMock } = vi.hoisted(() => ({ getDocsMock: vi.fn() }));

vi.mock('@/lib/firebase/config', () => ({ firestore: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_fs: unknown, path: string) => ({ path }),
  getDocs: (ref: unknown) => getDocsMock(ref),
}));

const { pullCloudChangesBeforePush } = await import('@/lib/firebase/cloud-pull-service');

type CloudDoc = { id: string; body: Record<string, unknown> };

/** Route getDocs by the trailing collection name in `users/<uid>/<name>`. */
function setCloud(map: Record<string, CloudDoc[]>): void {
  getDocsMock.mockImplementation((ref: { path: string }) => {
    const name = ref.path.split('/').pop() ?? '';
    const rows = map[name] ?? [];
    return Promise.resolve({ docs: rows.map((r) => ({ id: r.id, data: () => r.body })) });
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

const OLDER = '2026-01-01T00:00:00.000Z';
const NEWER = '2026-02-01T00:00:00.000Z';

describe('cloud-pull-service: pullCloudChangesBeforePush', () => {
  beforeEach(async () => {
    await resetTestDb();
    getDocsMock.mockReset();
    setCloud({});
  });

  it('lands a brand-new cloud product locally even when the doc body omits its id (id-fallback)', async () => {
    // Regression guard: older/partial cloud docs put the id only on the
    // Firestore document, not in the body. Without the fallback the row was
    // written as id:undefined and silently lost.
    setCloud({
      products: [{ id: 'prod-new', body: { name: 'Imported', barcode: '900', category: 'General', unit: 'piece', quantityInStock: 4, buyPrice: 2, sellPrice: 5, minimumStockAlert: 0, status: 'active', dateAdded: OLDER, lastUpdated: OLDER } }],
    });

    await pullCloudChangesBeforePush('uid-1');

    await expect(db.products.get('prod-new')).resolves.toMatchObject({ id: 'prod-new', name: 'Imported', syncStatus: 'synced' });
  });

  it('overwrites a clean local product when the cloud copy is newer', async () => {
    await seedProduct({ id: 'p1', barcode: '111', name: 'Local name', syncedAt: OLDER });
    setCloud({ products: [{ id: 'p1', body: { ...makeProduct({ id: 'p1', barcode: '111', name: 'Cloud name' }), syncedAt: NEWER } }] });

    await pullCloudChangesBeforePush('uid-1');

    await expect(db.products.get('p1')).resolves.toMatchObject({ name: 'Cloud name', syncStatus: 'synced' });
    await expect(db.syncConflicts.count()).resolves.toBe(0);
  });

  it('raises a conflict instead of overwriting when the device has an unsynced local edit', async () => {
    await seedProduct({ id: 'p1', barcode: '111', name: 'Local name', syncedAt: OLDER, syncStatus: 'pending' });
    await db.syncQueue.put({ id: getSyncQueueId('product', 'p1'), entity: 'product', entityId: 'p1', operation: 'update', status: 'pending', retryCount: 0, createdAt: OLDER, updatedAt: OLDER });
    setCloud({ products: [{ id: 'p1', body: { ...makeProduct({ id: 'p1', barcode: '111', name: 'Cloud name' }), syncedAt: NEWER } }] });

    await pullCloudChangesBeforePush('uid-1');

    await expect(db.products.get('p1')).resolves.toMatchObject({ name: 'Local name', syncStatus: 'conflict' });
    await expect(db.syncConflicts.get('conflict:product:p1:pull-cloud')).resolves.toMatchObject({
      conflictType: 'same_field_changed',
      changedFields: ['name'],
    });
  });

  it('max-merges settings counters and re-queues a push when this device is ahead', async () => {
    await seedSettings({ nextBillSequence: 10, syncedAt: OLDER });
    setCloud({ settings: [{ id: 'app-settings', body: { ...makeSettings({ nextBillSequence: 5 }), syncedAt: NEWER } }] });

    await pullCloudChangesBeforePush('uid-1');

    await expect(db.settings.get('app-settings')).resolves.toMatchObject({ nextBillSequence: 10, syncStatus: 'pending' });
    await expect(db.syncQueue.get(getSyncQueueId('settings', 'app-settings'))).resolves.toMatchObject({ entity: 'settings', status: 'pending' });
    await expect(db.syncConflicts.count()).resolves.toBe(0);
  });

  it('propagates a remote void/return onto a local bill with no pending local job', async () => {
    await db.bills.put(makeBill({ id: 'bill-1', status: 'finalized', syncedAt: OLDER }));
    setCloud({ bills: [{ id: 'bill-1', body: makeBill({ id: 'bill-1', status: 'voided', returnedAmount: 100, syncedAt: NEWER }) as unknown as Record<string, unknown> }] });

    await pullCloudChangesBeforePush('uid-1');

    await expect(db.bills.get('bill-1')).resolves.toMatchObject({ status: 'voided', returnedAmount: 100, syncStatus: 'synced' });
  });

  it('does not clobber a bill that has an unsynced local change', async () => {
    await db.bills.put(makeBill({ id: 'bill-1', status: 'finalized', syncedAt: OLDER }));
    await db.syncQueue.put({ id: getSyncQueueId('bill', 'bill-1'), entity: 'bill', entityId: 'bill-1', operation: 'update', status: 'pending', retryCount: 0, createdAt: OLDER, updatedAt: OLDER });
    setCloud({ bills: [{ id: 'bill-1', body: makeBill({ id: 'bill-1', status: 'voided', returnedAmount: 100, syncedAt: NEWER }) as unknown as Record<string, unknown> }] });

    await pullCloudChangesBeforePush('uid-1');

    await expect(db.bills.get('bill-1')).resolves.toMatchObject({ status: 'finalized' });
  });

  it('inserts missing append-only history rows (expenses) without touching existing ones', async () => {
    await db.expenses.put({ id: 'exp-existing', category: 'rent', amount: 100, paymentMethod: 'cash', createdAt: OLDER, syncStatus: 'synced' });
    setCloud({
      expenses: [
        { id: 'exp-existing', body: { id: 'exp-existing', category: 'rent', amount: 999, paymentMethod: 'cash', createdAt: OLDER } },
        { id: 'exp-new', body: { id: 'exp-new', category: 'internet', amount: 50, paymentMethod: 'bank', createdAt: NEWER } },
      ],
    });

    await pullCloudChangesBeforePush('uid-1');

    // Existing row is left as-is (append-only insert-if-missing), new row lands.
    await expect(db.expenses.get('exp-existing')).resolves.toMatchObject({ amount: 100 });
    await expect(db.expenses.get('exp-new')).resolves.toMatchObject({ amount: 50, syncStatus: 'synced' });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/schema';
import { resetTestDb } from '@/tests/helpers/db';
import type { SyncMeta } from '@/lib/firebase/sync-service';
import type { BillItemCostAllocation, InventoryLot } from '@/types/domain';

// fetchSyncMeta is the only cloud read the classifier makes. Stub it so the
// test runs entirely against fake-indexeddb without touching Firebase/config.
const { fetchSyncMetaMock } = vi.hoisted(() => ({ fetchSyncMetaMock: vi.fn() }));
vi.mock('@/lib/firebase/restore-service', () => ({ fetchSyncMeta: fetchSyncMetaMock }));

const { classifySyncStartupState } = await import('@/lib/services/sync-startup-decision-service');

function cloudMeta(overrides: Partial<SyncMeta['recordCounts']> = {}): SyncMeta {
  return {
    lastSyncedAt: '2026-06-01T00:00:00.000Z',
    recordCounts: {
      bills: 1,
      billItems: 1,
      products: 1,
      stockMovements: 1,
      purchases: 1,
      purchaseItems: 1,
      inventoryLots: 1,
      billItemCostAllocations: 1,
      ...overrides,
    },
  };
}

function settingsOnlyCloudMeta(): SyncMeta {
  return {
    lastSyncedAt: '2026-06-01T00:00:00.000Z',
    recordCounts: {
      bills: 0,
      billItems: 0,
      products: 0,
      productUnits: 0,
      stockMovements: 0,
      customerPayments: 0,
      customers: 0,
      shifts: 0,
      suppliers: 0,
      purchases: 0,
      purchaseItems: 0,
      supplierPayments: 0,
      auditEvents: 0,
      cashMovements: 0,
      expenses: 0,
      inventoryLots: 0,
      billItemCostAllocations: 0,
      settings: 1,
    },
  };
}

function makeLot(overrides: Partial<InventoryLot> = {}): InventoryLot {
  return {
    id: 'lot-1',
    productId: 'product-1',
    sourceType: 'opening_balance',
    sourceId: 'opening',
    receivedAt: '2026-01-01T00:00:00.000Z',
    quantityReceived: 5,
    quantityRemaining: 5,
    unitCost: 3,
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    syncStatus: 'synced',
    ...overrides,
  };
}

function makeAllocation(overrides: Partial<BillItemCostAllocation> = {}): BillItemCostAllocation {
  return {
    id: 'alloc-1',
    billId: 'bill-1',
    billItemId: 'item-1',
    productId: 'product-1',
    inventoryLotId: 'lot-1',
    quantity: 2,
    unitCost: 3,
    lineCost: 6,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    syncStatus: 'synced',
    ...overrides,
  };
}

describe('classifySyncStartupState integration', () => {
  beforeEach(async () => {
    await resetTestDb();
    fetchSyncMetaMock.mockReset();
  });

  it('fresh empty device + cloud data (incl. lots/allocations) => RESTORE_CLOUD_SILENTLY, no conflict', async () => {
    fetchSyncMetaMock.mockResolvedValue(cloudMeta());

    const result = await classifySyncStartupState({ uid: 'user-1' });

    expect(result.decision).toBe('RESTORE_CLOUD_SILENTLY');
    expect(result.conflicts).toBeUndefined();
    expect(result.cloudSummary.hasCloudData).toBe(true);
    expect(result.cloudSummary.entityCounts?.inventoryLots).toBe(1);
    expect(result.cloudSummary.entityCounts?.billItemCostAllocations).toBe(1);
    expect(result.localSummary.hasMeaningfulData).toBe(false);
  });

  it('brand-new account (empty local + empty cloud) => NO_ACTION_REQUIRED', async () => {
    fetchSyncMetaMock.mockResolvedValue(null);

    const result = await classifySyncStartupState({ uid: 'user-1' });

    expect(result.decision).toBe('NO_ACTION_REQUIRED');
    expect(result.cloudSummary.hasCloudData).toBe(false);
  });

  it('settings-only cloud metadata does not trigger the fresh-device restore loop', async () => {
    fetchSyncMetaMock.mockResolvedValue(settingsOnlyCloudMeta());

    const result = await classifySyncStartupState({ uid: 'user-1' });

    expect(result.decision).toBe('NO_ACTION_REQUIRED');
    expect(result.cloudSummary.hasCloudData).toBe(false);
    expect(result.cloudSummary.entityCounts?.settings).toBe(1);
  });

  it('local DB holding ONLY lots + allocations is NOT treated as empty (no false restore)', async () => {
    // Unified local-empty detection: FIFO-only data must count as meaningful so
    // a device that holds only lots/allocations is never offered a fresh restore.
    await db.inventoryLots.put(makeLot());
    await db.billItemCostAllocations.put(makeAllocation());
    fetchSyncMetaMock.mockResolvedValue(cloudMeta());

    const result = await classifySyncStartupState({ uid: 'user-1' });

    expect(result.localSummary.hasMeaningfulData).toBe(true);
    expect(result.decision).not.toBe('RESTORE_CLOUD_SILENTLY');
  });
});

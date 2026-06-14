import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db/schema';
import { getSyncQueueId } from '@/lib/services/sync-queue-service';
import {
  autoDismissFalseOfflineSaleConflicts,
  getOpenConflicts,
  resolveConflict,
  resolveConflictWithAction,
  saveConflict,
} from '@/lib/services/sync-conflict-service';
import { resetTestDb, seedProduct, seedSettings } from '@/tests/helpers/db';
import type { InventoryLot, SyncConflict } from '@/types/domain';

type ConflictInput = Omit<SyncConflict, 'id' | 'status' | 'createdAt'> & { id?: string };

function productConflict(overrides: Partial<ConflictInput> = {}): ConflictInput {
  return {
    id: 'conflict:product:product-1:same-field',
    entity: 'product',
    entityId: 'product-1',
    operationId: undefined,
    conflictType: 'same_field_changed',
    severity: 'medium',
    cloudRecord: { id: 'product-1', name: 'Cloud name' },
    localRecord: { id: 'product-1', name: 'Local name' },
    changedFields: ['name'],
    ...overrides,
  };
}

function seedLot(overrides: Partial<InventoryLot> = {}): InventoryLot {
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

function lotRecord(overrides: Partial<InventoryLot> = {}): Record<string, unknown> {
  return seedLot(overrides) as unknown as Record<string, unknown>;
}

function lotConflict(overrides: Partial<ConflictInput> = {}): ConflictInput {
  return {
    id: 'conflict:inventoryLot:lot-1:pull-cloud',
    entity: 'inventoryLot',
    entityId: 'lot-1',
    operationId: undefined,
    conflictType: 'inventory_overwrite',
    severity: 'high',
    cloudRecord: lotRecord(),
    localRecord: lotRecord(),
    changedFields: ['quantityRemaining'],
    ...overrides,
  };
}

describe('sync-conflict-service integration', () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  describe('saveConflict', () => {
    it('persists a new open conflict and returns its id', async () => {
      const id = await saveConflict(productConflict());

      expect(id).toBe('conflict:product:product-1:same-field');
      await expect(db.syncConflicts.get(id!)).resolves.toMatchObject({ status: 'open', changedFields: ['name'] });
    });

    it('does not duplicate or re-stamp a conflict that is already open', async () => {
      const id = await saveConflict(productConflict());
      const firstCreatedAt = (await db.syncConflicts.get(id!))!.createdAt;

      const again = await saveConflict(productConflict({ severity: 'high' }));

      expect(again).toBe(id);
      await expect(db.syncConflicts.count()).resolves.toBe(1);
      await expect(db.syncConflicts.get(id!)).resolves.toMatchObject({ createdAt: firstCreatedAt, severity: 'medium' });
    });

    it('stays closed when the same conflict is re-detected after the user resolved it', async () => {
      const id = await saveConflict(productConflict());
      await resolveConflict(id!, 'keep_local');

      const reopened = await saveConflict(productConflict());

      expect(reopened).toBeNull();
      await expect(db.syncConflicts.get(id!)).resolves.toMatchObject({ status: 'resolved' });
    });

    it('reopens when the cloud/local state has changed since the resolution', async () => {
      const id = await saveConflict(productConflict());
      await resolveConflict(id!, 'keep_local');

      const reopened = await saveConflict(productConflict({ cloudRecord: { id: 'product-1', name: 'Newer cloud name' } }));

      expect(reopened).toBe(id);
      await expect(db.syncConflicts.get(id!)).resolves.toMatchObject({ status: 'open' });
    });
  });

  describe('getOpenConflicts', () => {
    it('returns only open conflicts ordered by createdAt', async () => {
      const openId = await saveConflict(productConflict({ id: 'open-1' }));
      const resolvedId = await saveConflict(productConflict({ id: 'resolved-1', entityId: 'product-2', changedFields: ['sellPrice'] }));
      await resolveConflict(resolvedId!, 'keep_cloud');

      const open = await getOpenConflicts();

      expect(open.map((c) => c.id)).toEqual([openId]);
    });
  });

  describe('resolveConflictWithAction', () => {
    it('keep_cloud overwrites the local product with the cloud record and marks the queue synced', async () => {
      await seedProduct({ id: 'product-1', name: 'Local name', sellPrice: 8, syncStatus: 'pending' });
      const queueId = getSyncQueueId('product', 'product-1');
      await db.syncQueue.put({ id: queueId, entity: 'product', entityId: 'product-1', operation: 'update', status: 'pending', retryCount: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
      const id = await saveConflict(productConflict({
        conflictType: 'same_field_changed',
        cloudRecord: { id: 'product-1', name: 'Cloud name', sellPrice: 12, quantityInStock: 4, buyPrice: 5, category: 'General', unit: 'piece', barcode: '1', status: 'active', minimumStockAlert: 0, dateAdded: '2026-01-01T00:00:00.000Z', lastUpdated: '2026-01-01T00:00:00.000Z' },
        changedFields: ['name', 'sellPrice'],
      }));

      await resolveConflictWithAction(id!, 'keep_cloud');

      await expect(db.products.get('product-1')).resolves.toMatchObject({ name: 'Cloud name', sellPrice: 12, syncStatus: 'synced' });
      await expect(db.syncConflicts.get(id!)).resolves.toMatchObject({ status: 'resolved', resolution: 'keep_cloud' });
      await expect(db.syncQueue.get(queueId)).resolves.toMatchObject({ status: 'synced' });
    });

    it('keep_local re-queues the settings record for another push attempt', async () => {
      await seedSettings({ syncStatus: 'synced' });
      const queueId = getSyncQueueId('settings', 'app-settings');
      await db.syncQueue.put({ id: queueId, entity: 'settings', entityId: 'app-settings', operation: 'upsert', status: 'failed', retryCount: 3, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
      const id = await saveConflict({
        id: 'conflict:settings:app-settings:same-field',
        entity: 'settings',
        entityId: 'app-settings',
        conflictType: 'settings_conflict',
        severity: 'high',
        cloudRecord: { id: 'app-settings', currency: 'USD' },
        localRecord: { id: 'app-settings', currency: 'ILS' },
        changedFields: ['currency'],
      });

      await resolveConflictWithAction(id!, 'keep_local');

      await expect(db.settings.get('app-settings')).resolves.toMatchObject({ syncStatus: 'pending' });
      await expect(db.syncQueue.get(queueId)).resolves.toMatchObject({ status: 'pending', retryCount: 0 });
    });

    it('keep_cloud overwrites the local inventory lot and marks the queue synced', async () => {
      await db.inventoryLots.put(seedLot({ quantityRemaining: 2, syncStatus: 'conflict' }));
      const queueId = getSyncQueueId('inventoryLot', 'lot-1');
      await db.syncQueue.put({ id: queueId, entity: 'inventoryLot', entityId: 'lot-1', operation: 'update', status: 'conflict', retryCount: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
      const id = await saveConflict(lotConflict({
        cloudRecord: lotRecord({ quantityRemaining: 5, status: 'open' }),
        localRecord: lotRecord({ quantityRemaining: 2 }),
        changedFields: ['quantityRemaining'],
      }));

      await resolveConflictWithAction(id!, 'keep_cloud');

      await expect(db.inventoryLots.get('lot-1')).resolves.toMatchObject({ quantityRemaining: 5, syncStatus: 'synced' });
      await expect(db.syncConflicts.get(id!)).resolves.toMatchObject({ status: 'resolved', resolution: 'keep_cloud' });
      await expect(db.syncQueue.get(queueId)).resolves.toMatchObject({ status: 'synced' });
    });

    it('keep_local re-queues the inventory lot for another push attempt', async () => {
      await db.inventoryLots.put(seedLot({ quantityRemaining: 2, syncStatus: 'conflict' }));
      const queueId = getSyncQueueId('inventoryLot', 'lot-1');
      await db.syncQueue.put({ id: queueId, entity: 'inventoryLot', entityId: 'lot-1', operation: 'update', status: 'conflict', retryCount: 4, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
      const id = await saveConflict(lotConflict({
        cloudRecord: lotRecord({ quantityRemaining: 5 }),
        localRecord: lotRecord({ quantityRemaining: 2 }),
        changedFields: ['quantityRemaining'],
      }));

      await resolveConflictWithAction(id!, 'keep_local');

      // Local value untouched; both the lot row and its queue job leave the
      // stuck 'conflict' state and become pushable again.
      await expect(db.inventoryLots.get('lot-1')).resolves.toMatchObject({ quantityRemaining: 2, syncStatus: 'pending' });
      await expect(db.syncQueue.get(queueId)).resolves.toMatchObject({ status: 'pending', retryCount: 0 });
    });
  });

  describe('autoDismissFalseOfflineSaleConflicts', () => {
    it('closes a product quantity conflict when it exactly matches a pending offline bill movement', async () => {
      await seedProduct({ id: 'product-1', quantityInStock: 8, syncStatus: 'conflict' });
      const queueId = getSyncQueueId('product', 'product-1');
      await db.syncQueue.put({ id: queueId, entity: 'product', entityId: 'product-1', operation: 'update', status: 'failed', retryCount: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
      await db.stockMovements.add({ id: 'mv-1', productId: 'product-1', movementType: 'sale', quantityChange: -2, referenceType: 'bill', referenceId: 'bill-1', createdAt: '2026-01-01T00:00:00.000Z', syncStatus: 'pending' });
      const id = await saveConflict(productConflict({
        id: 'conflict:product:product-1:qty',
        conflictType: 'same_field_changed',
        changedFields: ['quantityInStock'],
        localRecord: { id: 'product-1', quantityInStock: 8 },
        cloudRecord: { id: 'product-1', quantityInStock: 10 },
      }));

      const dismissed = await autoDismissFalseOfflineSaleConflicts();

      expect(dismissed).toBe(1);
      await expect(db.syncConflicts.get(id!)).resolves.toMatchObject({ status: 'ignored', resolution: 'merge' });
      await expect(db.products.get('product-1')).resolves.toMatchObject({ syncStatus: 'pending' });
      await expect(db.syncQueue.get(queueId)).resolves.toMatchObject({ status: 'synced' });
    });

    it('closes a settings conflict that only differs on the monotonic sequence counters', async () => {
      await seedSettings({ syncStatus: 'conflict' });
      const queueId = getSyncQueueId('settings', 'app-settings');
      await db.syncQueue.put({ id: queueId, entity: 'settings', entityId: 'app-settings', operation: 'upsert', status: 'failed', retryCount: 2, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
      const id = await saveConflict({
        id: 'conflict:settings:app-settings:seq',
        entity: 'settings',
        entityId: 'app-settings',
        conflictType: 'settings_conflict',
        severity: 'high',
        cloudRecord: { id: 'app-settings', nextBillSequence: 3 },
        localRecord: { id: 'app-settings', nextBillSequence: 7 },
        changedFields: ['nextBillSequence'],
      });

      const dismissed = await autoDismissFalseOfflineSaleConflicts();

      expect(dismissed).toBe(1);
      await expect(db.syncConflicts.get(id!)).resolves.toMatchObject({ status: 'ignored' });
      await expect(db.syncQueue.get(queueId)).resolves.toMatchObject({ status: 'pending', retryCount: 0 });
    });

    it('leaves a genuine business-field conflict open', async () => {
      const id = await saveConflict(productConflict({ changedFields: ['name'] }));

      const dismissed = await autoDismissFalseOfflineSaleConflicts();

      expect(dismissed).toBe(0);
      await expect(db.syncConflicts.get(id!)).resolves.toMatchObject({ status: 'open' });
    });
  });
});

import { db } from '@/lib/db/schema';
import { nowIso } from '@/lib/utils/date';
import { getSyncQueueId } from '@/lib/services/sync-queue-service';
import { isSettingsSequenceField } from '@/lib/services/settings-sync-fields';
import type { InventoryLot, Settings, Product, SyncConflict, SyncConflictResolution } from '@/types/domain';
import { decideAutoConflictResolution } from '@/lib/sync/auto-conflict-policy';

function requestSync(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('shopkeeper:sync-requested'));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function sameConflictFingerprint(
  existing: SyncConflict,
  next: Omit<SyncConflict, 'id' | 'status' | 'createdAt'> & { id?: string },
): boolean {
  return existing.entity === next.entity &&
    existing.entityId === next.entityId &&
    existing.conflictType === next.conflictType &&
    stableStringify(existing.changedFields) === stableStringify(next.changedFields) &&
    stableStringify(existing.cloudRecord) === stableStringify(next.cloudRecord) &&
    stableStringify(existing.localRecord) === stableStringify(next.localRecord);
}

function numberOrZero(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isOnlyQuantityProductConflict(conflict: SyncConflict): boolean {
  return conflict.entity === 'product' &&
    conflict.status === 'open' &&
    ['inventory_overwrite', 'same_field_changed'].includes(conflict.conflictType) &&
    conflict.changedFields.length > 0 &&
    conflict.changedFields.every((field) => field === 'quantityInStock');
}

function isOnlySequenceConflict(conflict: SyncConflict): boolean {
  return conflict.entity === 'settings' &&
    conflict.status === 'open' &&
    conflict.conflictType === 'settings_conflict' &&
    conflict.changedFields.length > 0 &&
    conflict.changedFields.every((field) => isSettingsSequenceField(field));
}

async function isFalseOfflineBillStockConflict(conflict: SyncConflict): Promise<boolean> {
  if (!isOnlyQuantityProductConflict(conflict)) return false;

  const localQuantity = numberOrZero(conflict.localRecord.quantityInStock);
  const cloudQuantity = numberOrZero(conflict.cloudRecord.quantityInStock);
  const expectedDelta = localQuantity - cloudQuantity;

  const pendingBillMovements = (await db.stockMovements.where('productId').equals(conflict.entityId).toArray())
    .filter((movement) => movement.referenceType === 'bill' && movement.syncStatus !== 'synced');
  if (pendingBillMovements.length === 0) return false;

  const actualDelta = pendingBillMovements.reduce((sum, movement) => sum + numberOrZero(movement.quantityChange), 0);
  return Math.abs(expectedDelta - actualDelta) <= 0.000001;
}


async function applyAutomaticResolution(conflict: SyncConflict, resolution: SyncConflictResolution, resolvedAt: string): Promise<void> {
  const queueId = conflict.operationId ?? getSyncQueueId(conflict.entity, conflict.entityId);

  if (conflict.entity === 'product' && resolution === 'merge') {
    const cloud = conflict.cloudRecord as unknown as Product;
    const local = conflict.localRecord as unknown as Product;
    const merged = { ...cloud } as Product;
    for (const field of conflict.changedFields) {
      (merged as unknown as Record<string, unknown>)[field] = (local as unknown as Record<string, unknown>)[field];
    }
    merged.syncStatus = 'pending';
    merged.lastSyncError = undefined;
    await db.products.put(merged);
    await db.syncQueue.update(queueId, {
      status: 'pending',
      retryCount: 0,
      updatedAt: resolvedAt,
      lastError: undefined,
    });
    return;
  }

  if (conflict.entity === 'settings' && resolution === 'merge') {
    const cloud = conflict.cloudRecord as unknown as Settings;
    const local = conflict.localRecord as unknown as Settings;
    const merged: Settings = { ...cloud, ...local };

    // Offline devices may both reserve receipt numbers while disconnected. Do
    // not let the settings counter move backwards or choose an arbitrary last
    // writer: keep the highest known next sequence so future receipts continue
    // from a safe ceiling. Existing additive bill records are kept separately.
    if (conflict.changedFields.includes('nextBillSequence')) {
      merged.nextBillSequence = Math.max(
        Number(cloud.nextBillSequence) || 0,
        Number(local.nextBillSequence) || 0,
      );
    }
    if (conflict.changedFields.includes('nextPurchaseSequence')) {
      merged.nextPurchaseSequence = Math.max(
        Number(cloud.nextPurchaseSequence) || 0,
        Number(local.nextPurchaseSequence) || 0,
      );
    }

    merged.syncStatus = 'pending';
    merged.lastSyncError = undefined;
    await db.settings.put(merged);
    await db.syncQueue.update(queueId, {
      status: 'pending',
      retryCount: 0,
      updatedAt: resolvedAt,
      lastError: undefined,
    });
    return;
  }

  if (resolution === 'keep_both') {
    await db.syncQueue.update(queueId, {
      status: 'pending',
      retryCount: 0,
      updatedAt: resolvedAt,
      lastError: undefined,
    });
  }
}

async function markConflictIgnored(conflict: SyncConflict): Promise<void> {
  await db.syncConflicts.update(conflict.id, {
    status: 'ignored',
    resolution: 'merge',
    resolvedAt: nowIso(),
  });
}

export async function getOpenConflicts(): Promise<SyncConflict[]> {
  return db.syncConflicts.where('status').equals('open').sortBy('createdAt');
}

/**
 * Older builds could create manual-looking conflicts for ordinary offline bill
 * stock changes. Close only the cases that match pending bill movement deltas.
 */
export async function autoDismissFalseOfflineSaleConflicts(): Promise<number> {
  const openConflicts = await getOpenConflicts();
  let dismissed = 0;

  for (const conflict of openConflicts) {
    if (await isFalseOfflineBillStockConflict(conflict)) {
      const resolvedAt = nowIso();
      const queueId = conflict.operationId ?? getSyncQueueId('product', conflict.entityId);
      await db.transaction('rw', [db.syncConflicts, db.products, db.syncQueue], async () => {
        await db.syncConflicts.update(conflict.id, {
          status: 'ignored',
          resolution: 'merge',
          resolvedAt,
        });
        await db.products.update(conflict.entityId, { syncStatus: 'pending', lastSyncError: undefined });
        await db.syncQueue.update(queueId, {
          status: 'synced',
          syncedAt: resolvedAt,
          updatedAt: resolvedAt,
          lastError: undefined,
        });
      });
      dismissed += 1;
      continue;
    }

    if (isOnlySequenceConflict(conflict)) {
      await db.transaction('rw', [db.syncConflicts, db.settings, db.syncQueue], async () => {
        await markConflictIgnored(conflict);
        await db.settings.update(conflict.entityId, { syncStatus: 'pending', lastSyncError: undefined });
        await db.syncQueue.update(conflict.operationId ?? getSyncQueueId('settings', conflict.entityId), {
          status: 'pending',
          retryCount: 0,
          updatedAt: nowIso(),
          lastError: undefined,
        });
      });
      dismissed += 1;
    }
  }

  return dismissed;
}

/**
 * Explicit safe-merge pass over open conflicts (multi-user offline sprint).
 *
 * Detection (saveConflict) always raises and leaves conflicts open so the
 * review safety net is preserved. This pass runs afterwards and auto-applies
 * ONLY the decisions the policy considers safe (merge / keep_both). Anything the
 * policy defers — destructive, financially ambiguous, or unknown — is left open
 * for the user, so genuine price/inventory conflicts still surface. Returns the
 * number of conflicts auto-resolved.
 */
export async function autoResolveSafeConflicts(): Promise<number> {
  const openConflicts = await getOpenConflicts();
  let resolved = 0;

  for (const conflict of openConflicts) {
    const decision = decideAutoConflictResolution(conflict);
    if (decision.resolution === 'defer') continue;

    const resolution = decision.resolution;
    const resolvedAt = nowIso();
    await db.transaction('rw', [db.syncConflicts, db.products, db.settings, db.syncQueue], async () => {
      await applyAutomaticResolution(conflict, resolution, resolvedAt);
      await db.syncConflicts.update(conflict.id, {
        status: 'ignored',
        resolution,
        resolvedAt,
      });
    });
    resolved += 1;
  }

  if (resolved > 0) requestSync();
  return resolved;
}

export async function resolveConflict(
  id: string,
  resolution: SyncConflictResolution,
  resolvedByUserId?: string,
): Promise<void> {
  await db.syncConflicts.update(id, {
    status: 'resolved',
    resolution,
    resolvedByUserId,
    resolvedAt: nowIso(),
  });
}

export async function resolveConflictWithAction(
  id: string,
  resolution: SyncConflictResolution,
  resolvedByUserId?: string,
): Promise<void> {
  const conflict = await db.syncConflicts.get(id);
  if (!conflict) return;

  const resolvedAt = nowIso();

  await db.transaction('rw', [db.syncConflicts, db.products, db.settings, db.inventoryLots, db.syncQueue], async () => {
    await db.syncConflicts.update(id, {
      status: 'resolved',
      resolution,
      resolvedByUserId,
      resolvedAt,
    });

    if (conflict.entity === 'product') {
      const queueId = conflict.operationId ?? getSyncQueueId('product', conflict.entityId);
      if (resolution === 'keep_cloud') {
        await db.products.put({
          ...(conflict.cloudRecord as unknown as Product),
          syncStatus: 'synced',
          lastSyncError: undefined,
        });
        await db.syncQueue.update(queueId, {
          status: 'synced',
          syncedAt: resolvedAt,
          updatedAt: resolvedAt,
          lastError: undefined,
        });
      } else if (resolution === 'keep_local' || resolution === 'manual') {
        await db.products.update(conflict.entityId, {
          syncStatus: 'pending',
          lastSyncError: undefined,
        });
        await db.syncQueue.update(queueId, {
          status: 'pending',
          retryCount: 0,
          updatedAt: resolvedAt,
          lastError: undefined,
        });
      }
    }

    if (conflict.entity === 'settings') {
      const queueId = conflict.operationId ?? getSyncQueueId('settings', conflict.entityId);
      if (resolution === 'keep_cloud') {
        await db.settings.put({
          ...(conflict.cloudRecord as unknown as Settings),
          syncStatus: 'synced',
          lastSyncError: undefined,
        });
        await db.syncQueue.update(queueId, {
          status: 'synced',
          syncedAt: resolvedAt,
          updatedAt: resolvedAt,
          lastError: undefined,
        });
      } else if (resolution === 'keep_local' || resolution === 'manual') {
        await db.settings.update(conflict.entityId, {
          syncStatus: 'pending',
          lastSyncError: undefined,
        });
        await db.syncQueue.update(queueId, {
          status: 'pending',
          retryCount: 0,
          updatedAt: resolvedAt,
          lastError: undefined,
        });
      }
    }

    // FIFO inventory lots are mutable (every sale/return/void changes
    // quantityRemaining + status), so pullInventoryLots can raise lot
    // conflicts. Without this branch, resolving a lot conflict marked the
    // syncConflicts row resolved but left the lot row and its queue job stuck
    // in 'conflict' — the modal closed yet the device stayed unsynced.
    if (conflict.entity === 'inventoryLot') {
      const queueId = conflict.operationId ?? getSyncQueueId('inventoryLot', conflict.entityId);
      if (resolution === 'keep_cloud') {
        await db.inventoryLots.put({
          ...(conflict.cloudRecord as unknown as InventoryLot),
          syncStatus: 'synced',
          lastSyncError: undefined,
        });
        await db.syncQueue.update(queueId, {
          status: 'synced',
          syncedAt: resolvedAt,
          updatedAt: resolvedAt,
          lastError: undefined,
        });
      } else if (resolution === 'keep_local' || resolution === 'manual') {
        await db.inventoryLots.update(conflict.entityId, {
          syncStatus: 'pending',
          lastSyncError: undefined,
        });
        await db.syncQueue.update(queueId, {
          status: 'pending',
          retryCount: 0,
          updatedAt: resolvedAt,
          lastError: undefined,
        });
      }
    }
  });

  if (resolution === 'keep_local' || resolution === 'manual') requestSync();
}

export async function saveConflict(
  conflict: Omit<SyncConflict, 'id' | 'status' | 'createdAt'> & { id?: string },
): Promise<string | null> {
  const id = conflict.id ?? `conflict:${conflict.entity}:${conflict.entityId}:${Date.now()}`;
  const existing = await db.syncConflicts.get(id);
  if (existing?.status === 'open') return id;

  // If the user has just resolved exactly the same conflict, do not reopen it
  // on the next sync pass. A new cloud/local state will still create a review.
  if (existing && sameConflictFingerprint(existing, { ...conflict, id })) {
    return null;
  }

  await db.syncConflicts.put({
    ...conflict,
    id,
    status: 'open',
    createdAt: nowIso(),
  });
  return id;
}

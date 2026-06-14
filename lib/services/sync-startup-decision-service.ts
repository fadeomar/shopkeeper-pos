/**
 * Sync startup decision classifier (async gatherer).
 *
 * Reads cheap local + cloud-meta signals and delegates to the pure
 * `decideSyncStartup` brain in `./sync-startup-decision`. It does NOT perform
 * sync itself — it returns one clear decision plus a human-readable reason. The
 * shell uses it to decide whether to silently restore; everything else
 * (push/pull/per-entity conflict raising) is handled by SyncProvider's runSync
 * and the cloud-pull/merge services.
 *
 * The cloud read is a single meta/sync doc fetch (no full collection scan), so
 * this is cheap enough to call on app open and resolves safely (no throw) when
 * offline.
 */

import { getLocalDataSummary, getActiveUid } from '@/lib/services/account-data-service';
import { getOpenConflicts } from '@/lib/services/sync-conflict-service';
import { fetchSyncMeta } from '@/lib/firebase/restore-service';
import type { SyncMeta } from '@/lib/firebase/sync-service';
import {
  decideSyncStartup,
  type SyncStartupConflict,
  type SyncStartupDecisionResult,
} from '@/lib/services/sync-startup-decision';

export {
  decideSyncStartup,
} from '@/lib/services/sync-startup-decision';
export type {
  SyncStartupDecision,
  SyncStartupConflict,
  SyncStartupDecisionResult,
  SyncStartupInput,
} from '@/lib/services/sync-startup-decision';

function cloudHasData(meta: SyncMeta | null): boolean {
  return Boolean(
    meta && Object.values(meta.recordCounts).some((count) => typeof count === 'number' && count > 0),
  );
}

function readLocalLastSyncedAt(uid: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const stored = window.localStorage.getItem(`shopkeeper_last_sync_${uid}`);
    if (!stored) return undefined;
    const meta = JSON.parse(stored) as SyncMeta;
    return meta.lastSyncedAt;
  } catch {
    return undefined;
  }
}

function readAccountMismatch(uid: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const lastUid = window.localStorage.getItem('shopkeeper_last_active_uid');
    return Boolean(lastUid && lastUid !== uid);
  } catch {
    // Fall back to the active-uid record used elsewhere in the app.
    const active = getActiveUid();
    return Boolean(active && active !== uid);
  }
}

/**
 * Gather live local + cloud-meta signals and classify the startup state.
 */
export async function classifySyncStartupState(input: {
  uid: string;
  deviceId?: string;
}): Promise<SyncStartupDecisionResult> {
  const [summary, openConflicts, meta] = await Promise.all([
    getLocalDataSummary(),
    getOpenConflicts(),
    fetchSyncMeta(input.uid),
  ]);

  const conflicts: SyncStartupConflict[] = openConflicts.map((conflict) => ({
    entityType: conflict.entity,
    entityId: conflict.entityId,
    reason: conflict.conflictType,
    localUpdatedAt:
      typeof conflict.localRecord?.updatedAt === 'string' ? conflict.localRecord.updatedAt : undefined,
    cloudUpdatedAt:
      typeof conflict.cloudRecord?.updatedAt === 'string' ? conflict.cloudRecord.updatedAt : undefined,
    fields: conflict.changedFields,
  }));

  return decideSyncStartup({
    hasMeaningfulLocalData: summary.hasBusinessData,
    pendingCount: summary.pending + summary.failed + summary.syncing + summary.blocked + summary.conflicts,
    conflicts,
    accountMismatch: readAccountMismatch(input.uid),
    cloud: {
      hasData: cloudHasData(meta),
      lastSyncedAt: meta?.lastSyncedAt,
      entityCounts: meta?.recordCounts,
    },
    localLastSyncedAt: readLocalLastSyncedAt(input.uid),
  });
}

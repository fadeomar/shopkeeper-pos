/**
 * Pure sync-startup decision logic — no Firebase, no Dexie, no DOM.
 *
 * This is the testable brain that maps local + cloud signals to exactly one
 * startup decision. The async gatherer that feeds it live signals lives in
 * `sync-startup-decision-service.ts`; keeping the logic dependency-free here is
 * what lets the full decision matrix be unit-tested without mocking anything.
 */

export type SyncStartupDecision =
  | 'RESTORE_CLOUD_SILENTLY'
  | 'PULL_CLOUD_SILENTLY'
  | 'PUSH_LOCAL_SILENTLY'
  | 'AUTO_MERGE'
  | 'SHOW_TRUE_CONFLICT'
  | 'SWITCH_ACCOUNT_OR_STORE_WARNING'
  | 'NO_ACTION_REQUIRED';

export interface SyncStartupConflict {
  entityType: string;
  entityId: string;
  reason: string;
  localUpdatedAt?: string;
  cloudUpdatedAt?: string;
  fields?: string[];
}

export interface SyncStartupDecisionResult {
  decision: SyncStartupDecision;
  reason: string;
  localSummary: {
    hasMeaningfulData: boolean;
    hasPendingChanges: boolean;
    pendingCount: number;
    lastSuccessfulSyncAt?: string;
  };
  cloudSummary: {
    hasCloudData: boolean;
    lastCloudChangeAt?: string;
    entityCounts?: Record<string, number>;
  };
  conflicts?: SyncStartupConflict[];
}

/** Pure inputs to the decision — gather these however the runtime can. */
export interface SyncStartupInput {
  /** True only when a business table (products/bills/…) has rows. Excludes
   *  settings, sync metadata, device id, caches and other non-business rows. */
  hasMeaningfulLocalData: boolean;
  /** Count of unsynced local work: pending + failed + syncing + conflict + blocked. */
  pendingCount: number;
  /** Open, unresolved per-entity conflicts. A non-empty list is the ONLY thing
   *  that should surface the conflict screen. */
  conflicts: SyncStartupConflict[];
  /** True when this device was last used by a different account/store. */
  accountMismatch: boolean;
  /** Cloud signal derived from the user's meta/sync doc. */
  cloud: { hasData: boolean; lastSyncedAt?: string; entityCounts?: Record<string, number> };
  /** This device's last successful full sync timestamp, if known. */
  localLastSyncedAt?: string;
}

function cloudIsNewer(cloudLastSyncedAt?: string, localLastSyncedAt?: string): boolean {
  if (!cloudLastSyncedAt) return false;
  // Local has data but no record of a successful sync — prefer a (non-destructive,
  // per-entity) pull so the device catches up rather than sitting on stale rows.
  if (!localLastSyncedAt) return true;
  const cloud = Date.parse(cloudLastSyncedAt);
  const local = Date.parse(localLastSyncedAt);
  if (!Number.isFinite(cloud)) return false;
  if (!Number.isFinite(local)) return true;
  return cloud > local;
}

function result(
  decision: SyncStartupDecision,
  reason: string,
  input: SyncStartupInput,
): SyncStartupDecisionResult {
  return {
    decision,
    reason,
    localSummary: {
      hasMeaningfulData: input.hasMeaningfulLocalData,
      hasPendingChanges: input.pendingCount > 0,
      pendingCount: input.pendingCount,
      lastSuccessfulSyncAt: input.localLastSyncedAt,
    },
    cloudSummary: {
      hasCloudData: input.cloud.hasData,
      lastCloudChangeAt: input.cloud.lastSyncedAt,
      entityCounts: input.cloud.entityCounts,
    },
    conflicts: input.conflicts.length > 0 ? input.conflicts : undefined,
  };
}

/**
 * Pure decision function. Precedence is deliberate:
 *   1. account/store switch     — never silently merge another store's data
 *   2. open conflicts           — the ONLY path to the conflict screen
 *   3. empty local + cloud data — fresh device → silent restore
 *   4. empty local + no cloud   — brand-new account → nothing to do
 *   5. pending + cloud newer    — push then pull; engine reconciles per entity
 *   6. pending + cloud same     — push local silently
 *   7. clean local + cloud newer — pull silently
 *   8. otherwise                — already in sync
 */
export function decideSyncStartup(input: SyncStartupInput): SyncStartupDecisionResult {
  if (input.accountMismatch) {
    return result('SWITCH_ACCOUNT_OR_STORE_WARNING', 'Device was last used by a different account/store.', input);
  }

  if (input.conflicts.length > 0) {
    return result(
      'SHOW_TRUE_CONFLICT',
      `${input.conflicts.length} unresolved same-record conflict(s) need a manual choice.`,
      input,
    );
  }

  if (!input.hasMeaningfulLocalData) {
    return input.cloud.hasData
      ? result('RESTORE_CLOUD_SILENTLY', 'Fresh device: no local business data, cloud has data.', input)
      : result('NO_ACTION_REQUIRED', 'Brand-new account: no local and no cloud data.', input);
  }

  const cloudNewer = cloudIsNewer(input.cloud.lastSyncedAt, input.localLastSyncedAt);

  if (input.pendingCount > 0) {
    return cloudNewer
      ? result('AUTO_MERGE', 'Pending local work and newer cloud — push then pull; reconciled per entity.', input)
      : result('PUSH_LOCAL_SILENTLY', 'Pending local work, cloud unchanged — push silently.', input);
  }

  if (cloudNewer) {
    return result('PULL_CLOUD_SILENTLY', 'Clean local, newer cloud — pull silently.', input);
  }

  return result('NO_ACTION_REQUIRED', 'Local and cloud already in sync.', input);
}

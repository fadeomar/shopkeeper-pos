import { describe, expect, it } from 'vitest';
import {
  decideSyncStartup,
  type SyncStartupInput,
} from '@/lib/services/sync-startup-decision';

function input(overrides: Partial<SyncStartupInput> = {}): SyncStartupInput {
  return {
    hasMeaningfulLocalData: true,
    pendingCount: 0,
    conflicts: [],
    accountMismatch: false,
    cloud: { hasData: true, lastSyncedAt: '2026-01-01T00:00:00.000Z' },
    localLastSyncedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('decideSyncStartup', () => {
  // Test 1 — fresh device with cloud data restores silently
  it('RESTORE_CLOUD_SILENTLY when local is empty, cloud has data, and this device has never synced it', () => {
    const result = decideSyncStartup(
      input({ hasMeaningfulLocalData: false, localLastSyncedAt: undefined }),
    );
    expect(result.decision).toBe('RESTORE_CLOUD_SILENTLY');
    expect(result.conflicts).toBeUndefined();
  });

  it('NO_ACTION_REQUIRED after an empty-business cloud snapshot was already restored', () => {
    const result = decideSyncStartup(input({ hasMeaningfulLocalData: false }));
    expect(result.decision).toBe('NO_ACTION_REQUIRED');
  });

  it('RESTORE_CLOUD_SILENTLY for an empty local DB when the cloud changed after the last empty restore', () => {
    const result = decideSyncStartup(
      input({
        hasMeaningfulLocalData: false,
        localLastSyncedAt: '2026-01-01T00:00:00.000Z',
        cloud: { hasData: true, lastSyncedAt: '2026-02-01T00:00:00.000Z' },
      }),
    );
    expect(result.decision).toBe('RESTORE_CLOUD_SILENTLY');
  });

  it('NO_ACTION_REQUIRED for a brand-new account with no local and no cloud data', () => {
    const result = decideSyncStartup(
      input({ hasMeaningfulLocalData: false, cloud: { hasData: false } }),
    );
    expect(result.decision).toBe('NO_ACTION_REQUIRED');
  });

  // Test 2 — clean local data pulls cloud silently
  it('PULL_CLOUD_SILENTLY when local is clean and cloud is newer', () => {
    const result = decideSyncStartup(
      input({
        pendingCount: 0,
        localLastSyncedAt: '2026-01-01T00:00:00.000Z',
        cloud: { hasData: true, lastSyncedAt: '2026-02-01T00:00:00.000Z' },
      }),
    );
    expect(result.decision).toBe('PULL_CLOUD_SILENTLY');
  });

  it('treats local-with-data-but-never-synced as needing a pull', () => {
    const result = decideSyncStartup(
      input({ pendingCount: 0, localLastSyncedAt: undefined }),
    );
    expect(result.decision).toBe('PULL_CLOUD_SILENTLY');
  });

  // Test 3 — pending local only pushes silently
  it('PUSH_LOCAL_SILENTLY when there is pending local work and cloud is unchanged', () => {
    const result = decideSyncStartup(
      input({
        pendingCount: 2,
        localLastSyncedAt: '2026-02-01T00:00:00.000Z',
        cloud: { hasData: true, lastSyncedAt: '2026-02-01T00:00:00.000Z' },
      }),
    );
    expect(result.decision).toBe('PUSH_LOCAL_SILENTLY');
    expect(result.localSummary.hasPendingChanges).toBe(true);
  });

  // Test 4 — additive changes from two devices auto-merge (Device B's view:
  // its own add is pending, and the cloud is newer because Device A added too).
  it('AUTO_MERGE when local has pending work and cloud is also newer', () => {
    const result = decideSyncStartup(
      input({
        pendingCount: 1,
        localLastSyncedAt: '2026-01-01T00:00:00.000Z',
        cloud: { hasData: true, lastSyncedAt: '2026-02-01T00:00:00.000Z' },
      }),
    );
    expect(result.decision).toBe('AUTO_MERGE');
  });

  // Test 5 — same-record edit shows a true conflict
  it('SHOW_TRUE_CONFLICT when there are open per-entity conflicts, with details', () => {
    const result = decideSyncStartup(
      input({
        conflicts: [
          {
            entityType: 'product',
            entityId: 'abc',
            reason: 'same_field_changed',
            fields: ['sellPrice'],
          },
        ],
      }),
    );
    expect(result.decision).toBe('SHOW_TRUE_CONFLICT');
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts?.[0]).toMatchObject({ entityId: 'abc', fields: ['sellPrice'] });
  });

  it('SWITCH_ACCOUNT_OR_STORE_WARNING when the device was last used by another account', () => {
    const result = decideSyncStartup(input({ accountMismatch: true }));
    expect(result.decision).toBe('SWITCH_ACCOUNT_OR_STORE_WARNING');
  });

  it('NO_ACTION_REQUIRED when local and cloud are already in sync', () => {
    const result = decideSyncStartup(input());
    expect(result.decision).toBe('NO_ACTION_REQUIRED');
  });

  describe('precedence', () => {
    it('account mismatch wins over everything, even open conflicts', () => {
      const result = decideSyncStartup(
        input({
          accountMismatch: true,
          conflicts: [{ entityType: 'product', entityId: 'x', reason: 'same_field_changed' }],
        }),
      );
      expect(result.decision).toBe('SWITCH_ACCOUNT_OR_STORE_WARNING');
    });

    it('a true conflict wins over a fresh-device restore', () => {
      const result = decideSyncStartup(
        input({
          hasMeaningfulLocalData: false,
          conflicts: [{ entityType: 'product', entityId: 'x', reason: 'same_field_changed' }],
        }),
      );
      expect(result.decision).toBe('SHOW_TRUE_CONFLICT');
    });

    it('a fresh-device restore wins over a pending push', () => {
      const result = decideSyncStartup(
        input({
          hasMeaningfulLocalData: false,
          pendingCount: 3,
          localLastSyncedAt: undefined,
        }),
      );
      expect(result.decision).toBe('RESTORE_CLOUD_SILENTLY');
    });
  });
});

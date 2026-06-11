const LOCK_PREFIX = 'shopkeeper_sync_run_lock';
const DEFAULT_TTL_MS = 60_000;

interface StoredSyncLock {
  owner: string;
  uid: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface SyncRunLock {
  acquired: boolean;
  owner: string;
  ownerAgeMs?: number;
  release: () => void;
}

function storageKey(uid: string): string {
  return `${LOCK_PREFIX}:${uid}`;
}

function safeParseLock(raw: string | null): StoredSyncLock | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSyncLock>;
    if (
      typeof parsed.owner !== 'string' ||
      typeof parsed.uid !== 'string' ||
      typeof parsed.acquiredAt !== 'number' ||
      typeof parsed.expiresAt !== 'number'
    ) {
      return null;
    }
    return parsed as StoredSyncLock;
  } catch {
    return null;
  }
}

function makeOwner(): string {
  return globalThis.crypto?.randomUUID?.() ?? `sync_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function noopLock(acquired = false, owner = 'server'): SyncRunLock {
  return { acquired, owner, release: () => undefined };
}

/**
 * Best-effort localStorage mutex for same-browser multi-tab sync runs.
 *
 * Firestore stock deltas are already idempotent, but two open tabs can still
 * waste network calls and produce confusing flicker in the queue UI. This lock
 * keeps only one tab processing the durable queue at a time. It is deliberately
 * short-lived: if a tab crashes mid-sync, the next run can take over after TTL.
 */
export function acquireSyncRunLock(uid: string, ttlMs = DEFAULT_TTL_MS): SyncRunLock {
  if (typeof window === 'undefined') return noopLock(true, 'server');

  const key = storageKey(uid);
  const now = Date.now();
  const existing = safeParseLock(window.localStorage.getItem(key));
  if (existing && existing.expiresAt > now) {
    return {
      acquired: false,
      owner: existing.owner,
      ownerAgeMs: now - existing.acquiredAt,
      release: () => undefined,
    };
  }

  const owner = makeOwner();
  const next: StoredSyncLock = {
    owner,
    uid,
    acquiredAt: now,
    expiresAt: now + ttlMs,
  };

  try {
    window.localStorage.setItem(key, JSON.stringify(next));
    const saved = safeParseLock(window.localStorage.getItem(key));
    if (saved?.owner !== owner) return noopLock(false, saved?.owner ?? owner);
  } catch {
    // If localStorage is unavailable, do not block sync. The provider's in-tab
    // guard still prevents duplicate runs inside the current React tree.
    return noopLock(true, owner);
  }

  return {
    acquired: true,
    owner,
    release: () => {
      try {
        const saved = safeParseLock(window.localStorage.getItem(key));
        if (saved?.owner === owner) window.localStorage.removeItem(key);
      } catch {
        // non-fatal
      }
    },
  };
}

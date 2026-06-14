export const STORAGE_LOW_REMAINING_RATIO = 0.1;
export const STORAGE_CRITICAL_REMAINING_RATIO = 0.03;
export const STORAGE_LOW_REMAINING_BYTES = 150 * 1024 * 1024;
export const STORAGE_CRITICAL_REMAINING_BYTES = 50 * 1024 * 1024;

export type StorageHealthStatus = 'unsupported' | 'unknown' | 'healthy' | 'low' | 'critical';
export type PersistentStorageResult = 'granted' | 'denied' | 'unsupported' | 'error';

export interface StorageHealthSnapshot {
  supported: boolean;
  persisted: boolean | null;
  usageBytes: number | null;
  quotaBytes: number | null;
  remainingBytes: number | null;
  usageRatio: number | null;
  status: StorageHealthStatus;
}

function finiteNonNegative(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric;
}

export function classifyStorageHealth(input: {
  usageBytes?: number | null;
  quotaBytes?: number | null;
}): Pick<StorageHealthSnapshot, 'remainingBytes' | 'usageRatio' | 'status'> {
  const usageBytes = finiteNonNegative(input.usageBytes);
  const quotaBytes = finiteNonNegative(input.quotaBytes);

  if (usageBytes === null || quotaBytes === null || quotaBytes <= 0) {
    return { remainingBytes: null, usageRatio: null, status: 'unknown' };
  }

  const remainingBytes = Math.max(0, quotaBytes - usageBytes);
  const usageRatio = Math.min(1, Math.max(0, usageBytes / quotaBytes));
  const remainingRatio = remainingBytes / quotaBytes;

  if (
    remainingRatio <= STORAGE_CRITICAL_REMAINING_RATIO ||
    remainingBytes <= STORAGE_CRITICAL_REMAINING_BYTES
  ) {
    return { remainingBytes, usageRatio, status: 'critical' };
  }

  if (
    remainingRatio <= STORAGE_LOW_REMAINING_RATIO ||
    remainingBytes <= STORAGE_LOW_REMAINING_BYTES
  ) {
    return { remainingBytes, usageRatio, status: 'low' };
  }

  return { remainingBytes, usageRatio, status: 'healthy' };
}

export async function getBrowserStorageHealth(): Promise<StorageHealthSnapshot> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return {
      supported: false,
      persisted: null,
      usageBytes: null,
      quotaBytes: null,
      remainingBytes: null,
      usageRatio: null,
      status: 'unsupported',
    };
  }

  try {
    const [estimate, persisted] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted?.().catch(() => null) ?? Promise.resolve(null),
    ]);
    const usageBytes = finiteNonNegative(estimate.usage);
    const quotaBytes = finiteNonNegative(estimate.quota);
    const classified = classifyStorageHealth({ usageBytes, quotaBytes });

    return {
      supported: true,
      persisted,
      usageBytes,
      quotaBytes,
      ...classified,
    };
  } catch {
    return {
      supported: true,
      persisted: null,
      usageBytes: null,
      quotaBytes: null,
      remainingBytes: null,
      usageRatio: null,
      status: 'unknown',
    };
  }
}

export async function requestPersistentStorage(): Promise<PersistentStorageResult> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return 'unsupported';
  }

  try {
    return (await navigator.storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'error';
  }
}

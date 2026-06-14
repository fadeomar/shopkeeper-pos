import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyStorageHealth,
  getBrowserStorageHealth,
  requestPersistentStorage,
} from '@/lib/services/storage-health-service';

type MockStorageManager = Pick<StorageManager, 'estimate' | 'persist' | 'persisted'>;

function setStorageManager(storage: MockStorageManager | undefined) {
  Object.defineProperty(window.navigator, 'storage', {
    configurable: true,
    value: storage,
  });
}

describe('storage-health-service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setStorageManager(undefined);
  });

  it('classifies healthy, low, and critical storage estimates without browser APIs', () => {
    expect(classifyStorageHealth({ usageBytes: 100 * 1024 * 1024, quotaBytes: 2 * 1024 * 1024 * 1024 })).toMatchObject({
      remainingBytes: 2_042_626_048,
      usageRatio: 0.048828125,
      status: 'healthy',
    });

    expect(classifyStorageHealth({ usageBytes: 930 * 1024 * 1024, quotaBytes: 1_000 * 1024 * 1024 }).status).toBe('low');
    expect(classifyStorageHealth({ usageBytes: 980 * 1024 * 1024, quotaBytes: 1_000 * 1024 * 1024 }).status).toBe('critical');
  });

  it('returns unsupported when the StorageManager API is unavailable', async () => {
    setStorageManager(undefined);

    await expect(getBrowserStorageHealth()).resolves.toMatchObject({
      supported: false,
      status: 'unsupported',
      quotaBytes: null,
    });
    await expect(requestPersistentStorage()).resolves.toBe('unsupported');
  });

  it('reads browser estimate and persisted status when supported', async () => {
    setStorageManager({
      estimate: vi.fn().mockResolvedValue({ usage: 50 * 1024 * 1024, quota: 2 * 1024 * 1024 * 1024 }),
      persisted: vi.fn().mockResolvedValue(true),
      persist: vi.fn().mockResolvedValue(true),
    });

    await expect(getBrowserStorageHealth()).resolves.toMatchObject({
      supported: true,
      persisted: true,
      usageBytes: 50 * 1024 * 1024,
      quotaBytes: 2 * 1024 * 1024 * 1024,
      remainingBytes: 2_095_054_848,
      status: 'healthy',
    });
    await expect(requestPersistentStorage()).resolves.toBe('granted');
  });

  it('fails safe when estimate or persist throws', async () => {
    setStorageManager({
      estimate: vi.fn().mockRejectedValue(new Error('quota read failed')),
      persisted: vi.fn().mockRejectedValue(new Error('persisted read failed')),
      persist: vi.fn().mockRejectedValue(new Error('denied by browser')),
    });

    await expect(getBrowserStorageHealth()).resolves.toMatchObject({
      supported: true,
      status: 'unknown',
      quotaBytes: null,
    });
    await expect(requestPersistentStorage()).resolves.toBe('error');
  });
});

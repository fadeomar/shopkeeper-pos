import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db/schema';
import {
  clearTrustedSession,
  getValidTrustedSession,
  rememberTrustedSession,
  TRUSTED_SESSION_STORAGE_KEY,
  TRUSTED_SESSION_TTL_MS,
} from '@/lib/services/local-auth-session-service';
import { resetTestDb } from '@/tests/helpers/db';
import type { AuthCacheEntry } from '@/types/domain';

function makeAuthUser(overrides: Partial<AuthCacheEntry> = {}): AuthCacheEntry {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    uid: 'uid-auth-test',
    email: 'cashier@example.test',
    name: 'Cashier',
    role: 'cashier',
    isActive: true,
    pendingApproval: false,
    createdAt: now,
    accountType: 'standard',
    subscriptionStatus: 'active',
    subscriptionStartAt: now,
    subscriptionEndAt: '2027-01-01T00:00:00.000Z',
    subscriptionEndAtMs: Date.parse('2027-01-01T00:00:00.000Z'),
    cachedAt: now,
    ...overrides,
  };
}

describe('local-auth-session-service integration', () => {
  beforeEach(async () => {
    await resetTestDb();
    window.localStorage.clear();
  });

  it('stores trusted session metadata and refreshes authCache', async () => {
    const validatedAt = new Date('2026-01-15T10:00:00.000Z');
    const user = makeAuthUser();

    const session = await rememberTrustedSession(user, validatedAt);
    const cached = await db.authCache.get(user.uid);

    expect(session.uid).toBe(user.uid);
    expect(session.lastOnlineValidatedAt).toBe(validatedAt.toISOString());
    expect(session.expiresAt).toBe(new Date(validatedAt.getTime() + TRUSTED_SESSION_TTL_MS).toISOString());
    expect(window.localStorage.getItem(TRUSTED_SESSION_STORAGE_KEY)).toContain(user.uid);
    expect(cached).toMatchObject({
      uid: user.uid,
      lastOnlineValidatedAt: validatedAt.toISOString(),
      offlineSessionExpiresAt: session.expiresAt,
    });
  });

  it('returns the trusted session and cached user before expiry', async () => {
    const validatedAt = new Date('2026-01-01T00:00:00.000Z');
    const user = makeAuthUser({ uid: 'uid-before-expiry' });
    await rememberTrustedSession(user, validatedAt);

    const result = await getValidTrustedSession(new Date('2026-01-20T00:00:00.000Z'));

    expect(result?.session.uid).toBe(user.uid);
    expect(result?.user.uid).toBe(user.uid);
  });

  it('returns null after expiry', async () => {
    await rememberTrustedSession(makeAuthUser(), new Date('2026-01-01T00:00:00.000Z'));

    const result = await getValidTrustedSession(new Date('2026-02-01T00:00:00.001Z'));

    expect(result).toBeNull();
  });

  it('returns null after explicit sign-out clears the trusted session', async () => {
    await rememberTrustedSession(makeAuthUser(), new Date('2026-01-01T00:00:00.000Z'));
    await clearTrustedSession('explicit_sign_out');

    await expect(getValidTrustedSession(new Date('2026-01-02T00:00:00.000Z'))).resolves.toBeNull();
  });

  it('returns null when metadata exists but authCache is missing', async () => {
    await rememberTrustedSession(makeAuthUser(), new Date('2026-01-01T00:00:00.000Z'));
    await db.authCache.clear();

    await expect(getValidTrustedSession(new Date('2026-01-02T00:00:00.000Z'))).resolves.toBeNull();
  });

  it('returns null when the stored device does not match this browser', async () => {
    await rememberTrustedSession(makeAuthUser(), new Date('2026-01-01T00:00:00.000Z'));
    window.localStorage.setItem('shopkeeper_device_id', 'another-device');

    await expect(getValidTrustedSession(new Date('2026-01-02T00:00:00.000Z'))).resolves.toBeNull();
  });

  it('does not persist accidental password or token-like fields', async () => {
    const unsafeUser = {
      ...makeAuthUser({ uid: 'uid-safe-fields' }),
      password: 'secret',
      accessToken: 'token',
      refreshToken: 'refresh',
      stsTokenManager: { secret: true },
    } as AuthCacheEntry;

    await rememberTrustedSession(unsafeUser, new Date('2026-01-01T00:00:00.000Z'));
    const rawSession = window.localStorage.getItem(TRUSTED_SESSION_STORAGE_KEY) ?? '';
    const cached = await db.authCache.get('uid-safe-fields') as (AuthCacheEntry & Record<string, unknown>) | undefined;

    expect(rawSession).not.toContain('secret');
    expect(rawSession).not.toContain('token');
    expect(cached?.password).toBeUndefined();
    expect(cached?.accessToken).toBeUndefined();
    expect(cached?.refreshToken).toBeUndefined();
    expect(cached?.stsTokenManager).toBeUndefined();
  });

  it('keeps active uid aligned with the remembered trusted user', async () => {
    const user = makeAuthUser({ uid: 'uid-active' });
    await rememberTrustedSession(user, new Date('2026-01-01T00:00:00.000Z'));

    expect(window.localStorage.getItem('shopkeeper_active_uid')).toBe('uid-active');
    expect(window.localStorage.getItem('shopkeeper_last_uid')).toBe('uid-active');
  });

  it('ignores malformed trusted session metadata instead of booting from stale authCache', async () => {
    const user = makeAuthUser({ uid: 'uid-malformed' });
    await db.authCache.put(user);
    window.localStorage.setItem(TRUSTED_SESSION_STORAGE_KEY, '{not valid json');

    await expect(getValidTrustedSession(new Date('2026-01-02T00:00:00.000Z'))).resolves.toBeNull();
  });

  it('does not trust a signed-out session marker if one is ever present in storage', async () => {
    const user = makeAuthUser({ uid: 'uid-signed-out-marker' });
    const session = await rememberTrustedSession(user, new Date('2026-01-01T00:00:00.000Z'));
    window.localStorage.setItem(
      TRUSTED_SESSION_STORAGE_KEY,
      JSON.stringify({ ...session, signedOutAt: '2026-01-02T00:00:00.000Z' }),
    );

    await expect(getValidTrustedSession(new Date('2026-01-03T00:00:00.000Z'))).resolves.toBeNull();
  });

});

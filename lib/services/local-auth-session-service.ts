import { db } from '@/lib/db/schema';
import { getOrCreateDeviceId, setActiveStoreId, setActiveUid } from '@/lib/services/account-data-service';
import { resolveStoreId, type AuthCacheEntry } from '@/types/domain';

export const TRUSTED_SESSION_TTL_DAYS = 30;
export const TRUSTED_SESSION_TTL_MS = TRUSTED_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
export const TRUSTED_SESSION_STORAGE_KEY = 'shopkeeper_trusted_auth_session_v1';

export interface TrustedAuthSession {
  uid: string;
  deviceId: string;
  cachedAt: string;
  lastOnlineValidatedAt: string;
  expiresAt: string;
  signedOutAt?: string;
}

export interface TrustedSessionResult {
  session: TrustedAuthSession;
  user: AuthCacheEntry;
}

type TrustedSessionClearReason = 'explicit_sign_out' | 'expired' | 'invalid' | 'profile_missing';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readStorage(): Storage | null {
  if (!isBrowser()) return null;
  try {
    // Accessing localStorage can throw in hardened/private browser modes.
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeJsonParse(raw: string): TrustedAuthSession | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TrustedAuthSession>;
    if (
      typeof parsed.uid !== 'string' ||
      typeof parsed.deviceId !== 'string' ||
      typeof parsed.cachedAt !== 'string' ||
      typeof parsed.lastOnlineValidatedAt !== 'string' ||
      typeof parsed.expiresAt !== 'string'
    ) {
      return null;
    }
    return {
      uid: parsed.uid,
      deviceId: parsed.deviceId,
      cachedAt: parsed.cachedAt,
      lastOnlineValidatedAt: parsed.lastOnlineValidatedAt,
      expiresAt: parsed.expiresAt,
      signedOutAt: typeof parsed.signedOutAt === 'string' ? parsed.signedOutAt : undefined,
    };
  } catch {
    return null;
  }
}

async function ensureDbOpen(): Promise<void> {
  if (!db.isOpen()) {
    try { await db.open(); } catch { /* non-fatal: callers will handle table failures */ }
  }
}

function stripSensitiveFields(user: AuthCacheEntry): AuthCacheEntry {
  const copy = { ...user } as Record<string, unknown>;
  for (const key of [
    'password',
    'token',
    'idToken',
    'accessToken',
    'refreshToken',
    'stsTokenManager',
  ]) {
    delete copy[key];
  }
  return copy as unknown as AuthCacheEntry;
}

export function hasTrustedSessionExpired(session: TrustedAuthSession, now: Date = new Date()): boolean {
  const expiresAtMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs <= now.getTime();
}

export function getStoredTrustedSession(): TrustedAuthSession | null {
  const storage = readStorage();
  if (!storage) return null;
  const raw = storage.getItem(TRUSTED_SESSION_STORAGE_KEY);
  if (!raw) return null;
  return safeJsonParse(raw);
}

export async function rememberTrustedSession(
  user: AuthCacheEntry,
  validatedAt: Date = new Date(),
): Promise<TrustedAuthSession> {
  const lastOnlineValidatedAt = validatedAt.toISOString();
  const expiresAt = new Date(validatedAt.getTime() + TRUSTED_SESSION_TTL_MS).toISOString();
  const deviceId = getOrCreateDeviceId();
  const cachedUser: AuthCacheEntry = {
    ...stripSensitiveFields(user),
    cachedAt: lastOnlineValidatedAt,
    lastOnlineValidatedAt,
    offlineSessionExpiresAt: expiresAt,
  };
  const session: TrustedAuthSession = {
    uid: user.uid,
    deviceId,
    cachedAt: cachedUser.cachedAt,
    lastOnlineValidatedAt,
    expiresAt,
  };

  await ensureDbOpen();
  try { await db.authCache.put(cachedUser); } catch { /* cache write failed, non-fatal */ }
  try { setActiveUid(user.uid); setActiveStoreId(resolveStoreId(user) ?? user.uid); } catch { /* non-fatal */ }

  const storage = readStorage();
  if (storage) {
    try { storage.setItem(TRUSTED_SESSION_STORAGE_KEY, JSON.stringify(session)); } catch { /* non-fatal */ }
  }

  return session;
}

export async function getValidTrustedSession(now: Date = new Date()): Promise<TrustedSessionResult | null> {
  const session = getStoredTrustedSession();
  if (!session) return null;
  if (session.signedOutAt) return null;
  if (hasTrustedSessionExpired(session, now)) return null;

  let deviceId: string;
  try { deviceId = getOrCreateDeviceId(); } catch { return null; }
  if (session.deviceId !== deviceId) return null;

  await ensureDbOpen();
  let user: AuthCacheEntry | undefined;
  try { user = await db.authCache.get(session.uid); } catch { return null; }
  if (!user) return null;

  return { session, user };
}

export async function clearTrustedSession(_reason: TrustedSessionClearReason = 'invalid'): Promise<void> {
  const storage = readStorage();
  if (!storage) return;
  try { storage.removeItem(TRUSTED_SESSION_STORAGE_KEY); } catch { /* non-fatal */ }
}

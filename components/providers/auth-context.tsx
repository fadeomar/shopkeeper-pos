'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthChange, fetchUserDoc, signOut } from '@/lib/firebase/auth-service';
import { db } from '@/lib/db/schema';
import { getActiveUid, getLocalDataSummary, prepareRuntimeDbForUid, setActiveUid } from '@/lib/services/account-data-service';
import { useToast } from '@/components/ui/toast';
import { useLocale } from '@/components/providers/locale-context';
import type { AuthCacheEntry } from '@/types/domain';
import { getSubscriptionAccessState } from '@/lib/services/subscription-service';

export type AuthStatus = 'loading' | 'unauthenticated' | 'pending' | 'inactive' | 'subscription_expired' | 'authenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthCacheEntry | null;
  isAdmin: boolean;
  authError: string;
  logout: () => Promise<void>;
  /** Re-fetches the user profile from Firestore. Use on the pending/inactive screens to detect approval. */
  refreshStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const E2E_AUTH_STORAGE_KEY = 'shopkeeper-e2e-auth-v1';
const E2E_AUTH_ENABLED = process.env.NEXT_PUBLIC_E2E_AUTH === '1';

type E2ETestAuthPayload = Partial<Pick<AuthCacheEntry, 'uid' | 'email' | 'name' | 'phone' | 'role'>>;

function readE2ETestUser(): AuthCacheEntry | null {
  if (!E2E_AUTH_ENABLED || typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(E2E_AUTH_STORAGE_KEY);
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw) as E2ETestAuthPayload;
    const now = new Date();
    const subscriptionEnd = new Date(now);
    subscriptionEnd.setFullYear(subscriptionEnd.getFullYear() + 1);
    const uid = payload.uid?.trim() || 'e2e-cashier';
    return {
      uid,
      email: payload.email?.trim() || `${uid}@example.test`,
      name: payload.name?.trim() || 'E2E Cashier',
      phone: payload.phone,
      role: payload.role ?? 'cashier',
      isActive: true,
      pendingApproval: false,
      createdAt: now.toISOString(),
      accountType: 'standard',
      subscriptionStatus: 'active',
      subscriptionStartAt: now.toISOString(),
      subscriptionEndAt: subscriptionEnd.toISOString(),
      subscriptionEndAtMs: subscriptionEnd.getTime(),
      lastRenewedAt: now.toISOString(),
      renewalCount: 1,
      cachedAt: now.toISOString(),
    };
  } catch {
    return null;
  }
}


function resolveStatus(user: AuthCacheEntry): Exclude<AuthStatus, 'loading' | 'unauthenticated'> {
  if (user.pendingApproval ?? false) return 'pending';
  if (!user.isActive) return 'inactive';
  const accessState = getSubscriptionAccessState(user);
  if (accessState === 'expired' || accessState === 'suspended') return 'subscription_expired';
  return 'authenticated';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Render a usable login screen as the initial HTML. Firebase Auth only knows
  // the real session after client-side hydration; if hydration fails on a
  // mobile dev browser, SSR "loading" would otherwise be a permanent spinner.
  const [status, setStatus] = useState<AuthStatus>('unauthenticated');
  const [user, setUser] = useState<AuthCacheEntry | null>(null);
  const [authError, setAuthError] = useState('');
  const { push } = useToast();
  const { t } = useLocale();


  const resolveE2ETestUser = useCallback(async (entry: AuthCacheEntry) => {
    if (!db.isOpen()) {
      try { await db.open(); } catch { /* non-fatal */ }
    }

    try { await prepareRuntimeDbForUid(entry.uid); } catch (e) { console.warn('[auth:e2e] account data handoff failed:', e); }
    try { await db.authCache.put(entry); } catch { /* cache write failed, non-fatal */ }
    try { setActiveUid(entry.uid); } catch { /* non-fatal */ }
    setAuthError('');
    setUser(entry);
    setStatus(resolveStatus(entry));
  }, []);

  const resolveUser = useCallback(async (uid: string) => {
    // Ensure Dexie is open (DbBootstrap may not have mounted yet)
    if (!db.isOpen()) {
      try { await db.open(); } catch { /* non-fatal */ }
    }

    // When switching to a different account, check whether the outgoing
    // account had unsynced offline work. prepareRuntimeDbForUid below will
    // safely snapshot it to the per-account vault, so no data is lost — but
    // a new cashier landing on this browser deserves a heads-up that hidden
    // state exists for another account. The check has to happen BEFORE
    // prepareRuntimeDbForUid because that function swaps the runtime DB.
    const previousUid = getActiveUid();
    let unsyncedFromPriorAccount = 0;
    if (previousUid && previousUid !== uid) {
      try {
        const priorSummary = await getLocalDataSummary();
        if (priorSummary.hasUnsyncedWork) {
          unsyncedFromPriorAccount =
            priorSummary.pending +
            priorSummary.failed +
            priorSummary.syncing +
            priorSummary.blocked +
            priorSummary.conflicts;
        }
      } catch { /* non-fatal — silent skip if Dexie hiccups */ }
    }

    // Preserve the current account's local browser database before switching users.
    // This protects offline work while preventing data from one account being visible
    // to the next account on the same browser.
    try { await prepareRuntimeDbForUid(uid); } catch (e) { console.warn('[auth] account data handoff failed:', e); }

    if (unsyncedFromPriorAccount > 0) {
      push(
        t('auth.previousAccountUnsynced', { count: unsyncedFromPriorAccount }),
      );
    }

    try {
      const userDoc = await fetchUserDoc(uid);
      if (userDoc) {
        const entry: AuthCacheEntry = { ...userDoc, cachedAt: new Date().toISOString() };
        try { await db.authCache.put(entry); } catch { /* cache write failed, non-fatal */ }
        try { setActiveUid(uid); } catch { /* non-fatal */ }
        setAuthError('');
        setUser(entry);
        setStatus(resolveStatus(entry));
        return;
      }
      console.warn('[auth] No Firestore profile found for uid:', uid);
    } catch (e) {
      console.warn('[auth] fetchUserDoc failed:', e);
    }

    // Belt-and-suspenders: Dexie cache when Firestore misses (offline, doc never fetched)
    try {
      const cached = await db.authCache.get(uid);
      if (cached) {
        setAuthError('');
        setUser(cached);
        setStatus(resolveStatus(cached));
        return;
      }
    } catch { /* Dexie unavailable */ }

    // JWT exists but no local record — sign out and show a clear error
    await signOut();
    setUser(null);
    setStatus('unauthenticated');
    setAuthError('No profile found for this account. Ask your admin to create your profile through the app, then try again.');
  }, [push, t]);

  useEffect(() => {
    const e2eUser = readE2ETestUser();
    if (e2eUser) {
      setStatus('loading');
      void resolveE2ETestUser(e2eUser);
      return;
    }

    setStatus('loading');

    // Safety timeout: if Firebase Auth doesn't fire within 10 s (e.g. SDK hung,
    // IndexedDB blocked, very slow mobile network) fall back to the login screen
    // rather than showing a spinner forever.
    const fallbackTimer = setTimeout(() => {
      setStatus((prev) => {
        if (prev === 'loading') {
          console.warn('[auth] onAuthStateChanged did not fire within 10 s — falling back to unauthenticated');
          return 'unauthenticated';
        }
        return prev;
      });
    }, 10_000);

    const unsub = onAuthChange(async (firebaseUser) => {
      clearTimeout(fallbackTimer);
      if (!firebaseUser) {
        setUser(null);
        setStatus('unauthenticated');
        return;
      }
      await resolveUser(firebaseUser.uid);
    });

    return () => {
      clearTimeout(fallbackTimer);
      unsub();
    };
  }, [resolveUser, resolveE2ETestUser]);

  const logout = useCallback(async () => {
    if (E2E_AUTH_ENABLED && typeof window !== 'undefined') {
      window.localStorage.removeItem(E2E_AUTH_STORAGE_KEY);
    }
    await signOut();
    setUser(null);
    setAuthError('');
    setStatus('unauthenticated');
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!user) return;
    try {
      const userDoc = await fetchUserDoc(user.uid);
      if (userDoc) {
        const entry: AuthCacheEntry = { ...userDoc, cachedAt: new Date().toISOString() };
        try { await db.authCache.put(entry); } catch { /* non-fatal */ }
        setUser(entry);
        setStatus(resolveStatus(entry));
      }
    } catch { /* offline — silently ignore, user can try again */ }
  }, [user]);

  return (
    <AuthContext.Provider value={{ status, user, isAdmin: user?.role === 'owner', authError, logout, refreshStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthChange, fetchUserDoc, signOut } from '@/lib/firebase/auth-service';
import { db } from '@/lib/db/schema';
import type { AuthCacheEntry } from '@/types/domain';

export type AuthStatus = 'loading' | 'unauthenticated' | 'pending' | 'inactive' | 'authenticated';

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

function resolveStatus(user: AuthCacheEntry): Exclude<AuthStatus, 'loading' | 'unauthenticated'> {
  if (user.isActive) return 'authenticated';
  if (user.pendingApproval ?? false) return 'pending';
  return 'inactive';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Render a usable login screen as the initial HTML. Firebase Auth only knows
  // the real session after client-side hydration; if hydration fails on a
  // mobile dev browser, SSR "loading" would otherwise be a permanent spinner.
  const [status, setStatus] = useState<AuthStatus>('unauthenticated');
  const [user, setUser] = useState<AuthCacheEntry | null>(null);
  const [authError, setAuthError] = useState('');

  const resolveUser = useCallback(async (uid: string) => {
    // Ensure Dexie is open (DbBootstrap may not have mounted yet)
    if (!db.isOpen()) {
      try { await db.open(); } catch { /* non-fatal */ }
    }

    // If a different user was previously active on this device, wipe their local data.
    // Only runs online: after the wipe we reload and Firestore (which has its own separate
    // IndexedDB cache that is NOT wiped) re-supplies the profile. Offline logins for a brand-new
    // user on this device are impossible anyway — first login always requires network.
    try {
      const lastUid = localStorage.getItem('shopkeeper_last_uid');
      if (lastUid && lastUid !== uid && navigator.onLine) {
        // Set the new uid BEFORE reloading so the wipe doesn't re-trigger on reload.
        localStorage.setItem('shopkeeper_last_uid', uid);
        await db.delete(); // wipes only our Dexie DB; Firestore's own cache is unaffected
        window.location.reload();
        return; // unreachable — reload fires above
      }
    } catch { /* non-fatal */ }

    try {
      const userDoc = await fetchUserDoc(uid);
      if (userDoc) {
        const entry: AuthCacheEntry = { ...userDoc, cachedAt: new Date().toISOString() };
        try { await db.authCache.put(entry); } catch { /* cache write failed, non-fatal */ }
        try { localStorage.setItem('shopkeeper_last_uid', uid); } catch { /* non-fatal */ }
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
  }, []);

  useEffect(() => {
    console.log('[auth] client auth effect mounted');
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
      console.log('[auth] onAuthStateChanged fired:', firebaseUser ? firebaseUser.uid : null);
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
  }, [resolveUser]);

  const logout = useCallback(async () => {
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
    <AuthContext.Provider value={{ status, user, isAdmin: user?.role === 'admin', authError, logout, refreshStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

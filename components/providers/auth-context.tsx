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
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function resolveStatus(user: AuthCacheEntry): Exclude<AuthStatus, 'loading' | 'unauthenticated'> {
  if (user.isActive) return 'authenticated';
  if (user.pendingApproval) return 'pending';
  return 'inactive';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthCacheEntry | null>(null);

  const resolveUser = useCallback(async (uid: string) => {
    // Firestore with persistentLocalCache returns cached data offline — no special offline branch needed.
    // The catch only fires in edge cases (e.g. Firestore not yet initialized, permission error).
    try {
      const doc = await fetchUserDoc(uid);
      if (doc) {
        const entry: AuthCacheEntry = { ...doc, cachedAt: new Date().toISOString() };
        await db.authCache.put(entry);
        setUser(entry);
        setStatus(resolveStatus(entry));
        return;
      }
    } catch {
      // Firestore unavailable — fall through to Dexie cache
    }

    // Belt-and-suspenders: Dexie cache when Firestore misses (offline, doc never fetched)
    const cached = await db.authCache.get(uid);
    if (cached) {
      setUser(cached);
      setStatus(resolveStatus(cached));
    } else {
      // JWT exists but no local record at all — needs one online session first
      await signOut();
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthChange(async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setStatus('unauthenticated');
        return;
      }
      await resolveUser(firebaseUser.uid);
    });
    return unsub;
  }, [resolveUser]);

  const logout = useCallback(async () => {
    await signOut();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, isAdmin: user?.role === 'admin', logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

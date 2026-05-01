'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthChange, fetchUserDoc, signOut } from '@/lib/firebase/auth-service';
import { db } from '@/lib/db/schema';
import type { AuthCacheEntry } from '@/types/domain';

type AuthStatus = 'loading' | 'unauthenticated' | 'inactive' | 'authenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthCacheEntry | null;
  isAdmin: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthCacheEntry | null>(null);

  const resolveUser = useCallback(async (uid: string, email: string) => {
    // Try Firestore first (works online; returns cached data when offline due to persistence)
    try {
      const doc = await fetchUserDoc(uid);
      if (doc) {
        const entry: AuthCacheEntry = { ...doc, cachedAt: new Date().toISOString() };
        await db.authCache.put(entry);
        setUser(entry);
        setStatus(doc.isActive ? 'authenticated' : 'inactive');
        return;
      }
    } catch {
      // Firestore unavailable — fall through to local cache
    }

    // Fallback: local Dexie cache (offline, never-been-online-yet user stays out)
    const cached = await db.authCache.get(uid);
    if (cached) {
      setUser(cached);
      setStatus(cached.isActive ? 'authenticated' : 'inactive');
    } else {
      // Has Firebase JWT but no local record — needs online verification first
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
      await resolveUser(firebaseUser.uid, firebaseUser.email ?? '');
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

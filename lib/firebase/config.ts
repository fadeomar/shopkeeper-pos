import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

const isNewApp = getApps().length === 0;
export const firebaseApp = isNewApp ? initializeApp(firebaseConfig) : getApp();

/**
 * Firestore with offline persistence.
 *
 * Rules:
 * - On the SERVER (SSR/Node): IndexedDB doesn't exist → use plain getFirestore (in-memory).
 *   Using persistentLocalCache server-side silently corrupts the app singleton and
 *   causes onAuthStateChanged to never fire on the client.
 * - On the CLIENT: try persistent cache first; fall back gracefully if IndexedDB is
 *   unavailable (iOS private mode, some Android WebViews, etc.).
 */
export const firestore = (() => {
  // Already initialized — just return the existing instance
  if (!isNewApp) return getFirestore(firebaseApp);

  // Server-side: skip persistence entirely (no IndexedDB in Node.js)
  if (typeof window === 'undefined') return getFirestore(firebaseApp);

  // Client-side: try to enable offline persistence, fall back to default on failure
  try {
    return initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager(undefined) }),
    });
  } catch {
    // Happens in iOS private mode, some older Android WebViews, or if the user
    // has blocked IndexedDB storage. App still works — just without offline cache.
    console.warn('[firebase] Offline persistence unavailable, using in-memory cache.');
    return getFirestore(firebaseApp);
  }
})();

export const auth = getAuth(firebaseApp);

import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  getAuth,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  addDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { auth, firestore, firebaseApp } from './config';
import type { AppUser, UserRole } from '@/types/domain';
import { addCalendarMonths, buildInitialPaidSubscription, buildTrialSubscription, getSubscriptionAccessState, toSubscriptionMs } from '@/lib/services/subscription-service';

export function signIn(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function signOut() {
  return fbSignOut(auth);
}

export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export async function fetchUserDoc(uid: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(firestore, 'users', uid));
  if (!snap.exists()) return null;
  return snap.data() as AppUser;
}

export async function fetchAllUsers(): Promise<AppUser[]> {
  const snap = await getDocs(collection(firestore, 'users'));
  return snap.docs.map((d) => d.data() as AppUser);
}

export async function updateUserStatus(uid: string, isActive: boolean) {
  await updateDoc(doc(firestore, 'users', uid), {
    isActive,
    pendingApproval: false,
  });
}

export async function rejectUser(uid: string) {
  await updateDoc(doc(firestore, 'users', uid), {
    isActive: false,
    pendingApproval: false,
  });
}

export async function registerUser(
  email: string,
  password: string,
  name: string,
  phone?: string,
): Promise<void> {
  // Use secondary app to create the Firebase Auth user without triggering
  // onAuthStateChanged on the main app before the Firestore doc is ready.
  const tempApp = initializeApp(firebaseApp.options, `register-${Date.now()}`);
  let uid: string;
  try {
    const tempAuth = getAuth(tempApp);
    const cred = await createUserWithEmailAndPassword(tempAuth, email, password);
    uid = cred.user.uid;

    // Write Firestore doc before signing in on main auth — no race condition.
    // If the write fails (e.g. rules not deployed, network error), delete the
    // orphaned Firebase Auth user so the same email can be retried immediately
    // instead of getting "email already in use" forever.
    try {
      const now = new Date();
      await setDoc(doc(firestore, 'users', uid), {
        uid,
        email,
        name,
        ...(phone ? { phone } : {}),
        role: 'cashier',
        isActive: true,
        pendingApproval: false,
        ...buildTrialSubscription(now),
        createdAt: now.toISOString(),
      } satisfies AppUser);
    } catch (firestoreError) {
      try { await cred.user.delete(); } catch { /* best-effort — ignore if already gone */ }
      throw firestoreError;
    }
  } finally {
    await deleteApp(tempApp);
  }

  // Sign in on main auth — onAuthStateChanged fires after the doc exists.
  // Wrapped in try/catch: if network drops between account creation and sign-in,
  // the error bubbles to the SignUpForm and shows a message instead of silently failing.
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    // Account was created but sign-in failed. User can sign in manually.
    throw e;
  }
}

export async function createAppUser(
  email: string,
  password: string,
  name: string,
  role: UserRole,
  phone?: string,
): Promise<void> {
  // Secondary app so creating a user doesn't sign out the current admin
  const tempApp = initializeApp(firebaseApp.options, `create-user-${Date.now()}`);
  try {
    const tempAuth = getAuth(tempApp);
    const cred = await createUserWithEmailAndPassword(tempAuth, email, password);
    const now = new Date().toISOString();
    await setDoc(doc(firestore, 'users', cred.user.uid), {
      uid: cred.user.uid,
      email,
      name,
      ...(phone ? { phone } : {}),
      role,
      isActive: true,
      pendingApproval: false,
      ...buildInitialPaidSubscription(new Date(now), 1),
      createdAt: now,
    } satisfies AppUser);
  } finally {
    await deleteApp(tempApp);
  }
}


export async function renewUserSubscription(uid: string, months = 1): Promise<AppUser> {
  const ref = doc(firestore, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('User not found');
  const user = snap.data() as AppUser;
  const now = new Date();
  const existingEndMs = toSubscriptionMs(user.subscriptionEndAt, user.subscriptionEndAtMs);
  const isCurrentlyUsable = getSubscriptionAccessState(user) === 'active' || getSubscriptionAccessState(user) === 'trial';
  const base = isCurrentlyUsable && existingEndMs && existingEndMs > now.getTime()
    ? new Date(existingEndMs)
    : now;
  const nextEnd = addCalendarMonths(base, months);
  const next: Partial<AppUser> = {
    accountType: 'standard',
    subscriptionStatus: 'active',
    subscriptionStartAt: user.subscriptionStartAt ?? now.toISOString(),
    subscriptionEndAt: nextEnd.toISOString(),
    subscriptionEndAtMs: nextEnd.getTime(),
    subscriptionEndAtTimestamp: Timestamp.fromDate(nextEnd),
    lastRenewedAt: now.toISOString(),
    renewalCount: (user.renewalCount ?? 0) + 1,
    isActive: true,
    pendingApproval: false,
  };
  await updateDoc(ref, next);
  await addDoc(collection(firestore, `users/${uid}/subscriptionRenewals`), {
    uid,
    monthsAdded: months,
    oldEndAt: user.subscriptionEndAt ?? null,
    newEndAt: next.subscriptionEndAt,
    previousStatus: user.subscriptionStatus ?? null,
    createdAt: now.toISOString(),
    createdAtServer: serverTimestamp(),
  });
  return { ...user, ...next } as AppUser;
}

export async function suspendUserSubscription(uid: string, note?: string): Promise<void> {
  const now = new Date().toISOString();
  await updateDoc(doc(firestore, 'users', uid), {
    subscriptionStatus: 'suspended',
    subscriptionNote: note ?? 'Suspended by admin',
    lastRenewedAt: now,
  } satisfies Partial<AppUser>);
}

export async function markUserContacted(uid: string): Promise<void> {
  await updateDoc(doc(firestore, 'users', uid), {
    contactedAt: new Date().toISOString(),
  } satisfies Partial<AppUser>);
}

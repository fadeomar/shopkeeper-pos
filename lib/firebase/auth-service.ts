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
  getFirestore,
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
import { resolveStoreId, type AppUser, type UserRole } from '@/types/domain';
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
  // Defensive: a profile doc whose fields were lost (or that exists only as a
  // parent of POS subcollections) reads back as {} and would crash downstream
  // consumers assuming a valid AppUser shape — e.g. the admin list's
  // `name.localeCompare` sort. Skip docs missing the minimal identity fields
  // so one corrupt profile can't take down the whole admin page.
  return snap.docs
    .map((d) => d.data() as Partial<AppUser>)
    .filter((u): u is AppUser => typeof u?.uid === 'string' && typeof u?.name === 'string');
}

/**
 * Call an /api/admin/* route with the current user's Firebase ID token. These
 * actions (set password, delete user) need the Admin SDK, so they run on the
 * server; the route re-verifies the token and the caller's admin role. Throws
 * with the server's error message on a non-2xx response.
 */
async function callAdminApi(path: string, body: Record<string, unknown>): Promise<void> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not signed in.');
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? 'Request failed.');
  }
}

/** Overwrite a user's password (admin only). Cannot read existing passwords. */
export function adminSetUserPassword(uid: string, password: string): Promise<void> {
  return callAdminApi('/api/admin/set-password', { uid, password });
}

/** Permanently delete a user and ALL their data (admin only). Irreversible. */
export function adminDeleteUser(uid: string): Promise<void> {
  return callAdminApi('/api/admin/delete-user', { uid });
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

    // Write the profile through the SECONDARY app's Firestore, which is
    // authenticated as the just-created user (request.auth.uid == uid). This
    // lets the Firestore rule require `isOwner(uid)` for self-registration —
    // closing the previous hole where the create landed as an unauthenticated
    // request. The main-app sign-in still happens afterwards so
    // onAuthStateChanged only fires once the doc exists.
    const tempFirestore = getFirestore(tempApp);

    // Write Firestore doc before signing in on main auth — no race condition.
    // If the write fails (e.g. rules not deployed, network error), delete the
    // orphaned Firebase Auth user so the same email can be retried immediately
    // instead of getting "email already in use" forever.
    try {
      const now = new Date();
      await setDoc(doc(tempFirestore, 'users', uid), {
        uid,
        email,
        name,
        ...(phone ? { phone } : {}),
        role: 'owner',
        storeId: uid,
        storeRole: 'owner',
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
    const creatorUid = auth.currentUser?.uid;
    const creatorProfile = creatorUid ? await fetchUserDoc(creatorUid).catch(() => null) : null;
    // System administration creates customer store owners. A new owner must get
    // a fresh store scope (storeId = own uid); otherwise all newly created
    // owners would accidentally inherit the administration user's support scope.
    // Store-side staff creation should inherit the creator's store.
    const creatorRole = creatorProfile?.role as string | undefined;
    const creatorIsSystemAdmin = creatorRole === 'administration' || creatorRole === 'admin';
    const storeId = creatorIsSystemAdmin && role === 'owner'
      ? cred.user.uid
      : resolveStoreId(creatorProfile ?? (creatorUid ? { uid: creatorUid } as AppUser : null)) ?? cred.user.uid;
    await setDoc(doc(firestore, 'users', cred.user.uid), {
      uid: cred.user.uid,
      email,
      name,
      ...(phone ? { phone } : {}),
      role,
      storeId,
      storeRole: role,
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

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
} from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { auth, firestore, firebaseApp } from './config';
import type { AppUser } from '@/types/domain';

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

    // Write Firestore doc before signing in on main auth — no race condition
    await setDoc(doc(firestore, 'users', uid), {
      uid,
      email,
      name,
      ...(phone ? { phone } : {}),
      role: 'cashier',
      isActive: false,
      pendingApproval: true,
      createdAt: new Date().toISOString(),
    } satisfies AppUser);
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
  role: 'admin' | 'cashier',
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
      createdAt: now,
    } satisfies AppUser);
  } finally {
    await deleteApp(tempApp);
  }
}

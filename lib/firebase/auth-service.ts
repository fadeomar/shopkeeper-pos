import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
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
import { getAuth } from 'firebase/auth';
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
  await updateDoc(doc(firestore, 'users', uid), { isActive });
}

export async function createAppUser(
  email: string,
  password: string,
  name: string,
  role: 'admin' | 'cashier',
): Promise<void> {
  // Secondary app instance so creating a user doesn't sign out the current admin
  const tempApp = initializeApp(firebaseApp.options, `create-user-${Date.now()}`);
  try {
    const tempAuth = getAuth(tempApp);
    const cred = await createUserWithEmailAndPassword(tempAuth, email, password);
    const now = new Date().toISOString();
    await setDoc(doc(firestore, 'users', cred.user.uid), {
      uid: cred.user.uid,
      email,
      name,
      role,
      isActive: true,
      createdAt: now,
    } satisfies AppUser);
  } finally {
    await deleteApp(tempApp);
  }
}

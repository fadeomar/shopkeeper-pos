import { collection, getDocs, query, orderBy, limit, doc, setDoc } from 'firebase/firestore';
import { firestore } from './config';
import type { Bill, BillItem, Product, Settings } from '@/types/domain';

export async function fetchUserBills(uid: string, maxRows = 100): Promise<Bill[]> {
  const snap = await getDocs(
    query(
      collection(firestore, `users/${uid}/bills`),
      orderBy('createdAt', 'desc'),
      limit(maxRows),
    ),
  );
  return snap.docs.map((d) => d.data() as Bill);
}

export async function fetchUserBillItems(uid: string): Promise<BillItem[]> {
  const snap = await getDocs(collection(firestore, `users/${uid}/billItems`));
  return snap.docs.map((d) => d.data() as BillItem);
}

export async function fetchUserProducts(uid: string): Promise<Product[]> {
  const snap = await getDocs(
    query(collection(firestore, `users/${uid}/products`), orderBy('name')),
  );
  return snap.docs.map((d) => d.data() as Product);
}

export interface UserSummary {
  billCount: number;
  totalRevenue: number;
  productCount: number;
}

/**
 * Fetch the user's settings document from Firestore.
 * Returns null if the user hasn't synced settings yet or is unreachable.
 */
export async function fetchUserSettings(uid: string): Promise<Settings | null> {
  try {
    const snap = await getDocs(collection(firestore, `users/${uid}/settings`));
    if (snap.empty) return null;
    return snap.docs[0].data() as Settings;
  } catch {
    return null;
  }
}

/**
 * Overwrite the user's settings document in Firestore.
 * Called by admin when editing a user's settings from the admin panel.
 * The cashier will pick up the change on next reconnect via pullSettingsFromCloud.
 */
export async function updateUserSettingsInCloud(uid: string, settings: Settings): Promise<void> {
  await setDoc(doc(firestore, `users/${uid}/settings/${settings.id}`), settings);
}

export async function fetchUserSummary(uid: string): Promise<UserSummary> {
  const [bills, products] = await Promise.all([
    fetchUserBills(uid, 1000),
    fetchUserProducts(uid),
  ]);

  const totalRevenue = bills
    .filter((b) => b.status === 'finalized')
    .reduce((sum, b) => sum + b.totalAmount, 0);

  return {
    billCount: bills.length,
    totalRevenue,
    productCount: products.length,
  };
}

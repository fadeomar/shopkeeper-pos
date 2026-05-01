import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { firestore } from './config';
import type { Bill, BillItem, Product } from '@/types/domain';

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
  lastSyncedAt: string | null;
}

export async function fetchUserSummary(uid: string): Promise<UserSummary> {
  const [bills, products] = await Promise.all([
    fetchUserBills(uid, 1000),
    fetchUserProducts(uid),
  ]);

  const totalRevenue = bills
    .filter((b) => b.status === 'finalized')
    .reduce((sum, b) => sum + b.totalAmount, 0);

  const lastSyncedAt =
    bills.length > 0
      ? bills.reduce((latest, b) => (b.createdAt > latest ? b.createdAt : latest), bills[0].createdAt)
      : null;

  return {
    billCount: bills.length,
    totalRevenue,
    productCount: products.length,
    lastSyncedAt,
  };
}

import { writeBatch, doc, collection } from 'firebase/firestore';
import { firestore } from './config';
import { db } from '@/lib/db/schema';
import type { Bill, BillItem, Product } from '@/types/domain';

const BATCH_SIZE = 400; // Firestore max is 500; stay under

async function commitInBatches(
  writes: Array<{ ref: ReturnType<typeof doc>; data: object }>,
): Promise<void> {
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = writeBatch(firestore);
    writes.slice(i, i + BATCH_SIZE).forEach(({ ref, data }) => batch.set(ref, data));
    await batch.commit();
  }
}

export async function syncBillToCloud(
  uid: string,
  bill: Bill,
  items: BillItem[],
): Promise<void> {
  try {
    const writes = [
      { ref: doc(firestore, `users/${uid}/bills/${bill.id}`), data: bill },
      ...items.map((item) => ({
        ref: doc(firestore, `users/${uid}/billItems/${item.id}`),
        data: item,
      })),
    ];
    await commitInBatches(writes);
  } catch {
    // Firestore offline persistence queues the write — silently continue
  }
}

export async function syncProductsToCloud(
  uid: string,
  products: Product[],
): Promise<void> {
  if (products.length === 0) return;
  try {
    const writes = products.map((p) => ({
      ref: doc(firestore, `users/${uid}/products/${p.id}`),
      data: p,
    }));
    await commitInBatches(writes);
  } catch {
    // silent — offline writes are queued by Firestore SDK
  }
}

export async function syncAllToCloud(uid: string): Promise<void> {
  try {
    const [bills, billItems, products] = await Promise.all([
      db.bills.toArray(),
      db.billItems.toArray(),
      db.products.toArray(),
    ]);

    const writes = [
      ...bills.map((b) => ({
        ref: doc(firestore, `users/${uid}/bills/${b.id}`),
        data: b,
      })),
      ...billItems.map((i) => ({
        ref: doc(firestore, `users/${uid}/billItems/${i.id}`),
        data: i,
      })),
      ...products.map((p) => ({
        ref: doc(firestore, `users/${uid}/products/${p.id}`),
        data: p,
      })),
    ];

    await commitInBatches(writes);
  } catch {
    // silent
  }
}

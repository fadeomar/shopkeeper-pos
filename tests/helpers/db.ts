import Dexie from 'dexie';
import { db } from '@/lib/db/schema';
import { makeProduct, makeSettings } from '@/tests/helpers/builders';
import type { Product, Settings } from '@/types/domain';

export async function resetTestDb(): Promise<void> {
  if (db.isOpen()) db.close();
  await Dexie.delete(db.name);
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
  await db.open();
}

export async function seedSettings(overrides: Partial<Settings> = {}): Promise<Settings> {
  const settings = makeSettings(overrides);
  await db.settings.put(settings);
  return settings;
}

export async function seedProduct(overrides: Partial<Product> = {}): Promise<Product> {
  const product = makeProduct(overrides);
  await db.products.put(product);
  return product;
}

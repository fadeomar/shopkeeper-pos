import Dexie from 'dexie';
import { db } from '@/lib/db/schema';
import { buildOpeningLot } from '@/lib/db/inventory-lot-migration';
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
  // Mirror production: a product with stock must have a matching FIFO lot, or
  // sales (which consume lots) can never draw from it. Cost basis = buyPrice.
  const lot = buildOpeningLot(product, product.lastUpdated || product.dateAdded);
  if (lot) await db.inventoryLots.put(lot);
  return product;
}

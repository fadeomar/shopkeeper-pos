import Dexie from "dexie";
import { db } from "./schema";
import { createId } from "@/lib/utils/id";
import { nowIso } from "@/lib/utils/date";
import { normalizePhone } from "@/lib/utils/customer-key";
import { buildSyncQueueItem } from "@/lib/services/sync-queue-service";
import type {
  Bill,
  BillItem,
  Customer,
  Product,
  Settings,
  StockMovement,
  Supplier,
} from "@/types/domain";

export const SETTINGS_ID = "app-settings";

export function buildDefaultSettings(): Settings {
  const now = new Date().toISOString();

  return {
    id: SETTINGS_ID,
    storeName: "My Shop",
    cashierName: "",
    currency: "USD",
    allowLossSale: false,
    nextBillSequence: 1,
    lowStockHighlight: true,
    createdAt: now,
    updatedAt: now,
  };
}

async function requireSettings(): Promise<Settings> {
  const settings = await db.settings.get(SETTINGS_ID);

  if (!settings) {
    throw new Error(
      "Settings row not found. Call settingsRepo.init() before reading or updating settings.",
    );
  }

  return settings;
}

export const productRepo = {
  async list() {
    return db.products.orderBy("name").toArray();
  },

  async findById(id: string) {
    return db.products.get(id);
  },

  async findByBarcode(barcode: string) {
    return db.products.where("barcode").equals(barcode).first();
  },

  async save(product: Product) {
    return db.products.put(product);
  },

  async update(id: string, changes: Partial<Product>) {
    return db.products.update(id, changes);
  },
};

export const billRepo = {
  async list() {
    return db.bills.orderBy("createdAt").reverse().toArray();
  },

  async getWithItems(id: string) {
    const [bill, items] = await Promise.all([
      db.bills.get(id),
      db.billItems.where("billId").equals(id).toArray(),
    ]);

    return bill ? { bill, items } : undefined;
  },

  async createBillGraph(
    bill: Bill,
    items: BillItem[],
    stockMovements: StockMovement[],
    productsToUpdate: Product[],
  ) {
    return db.transaction(
      "rw",
      db.bills,
      db.billItems,
      db.stockMovements,
      db.products,
      async () => {
        await db.bills.add(bill);
        await db.billItems.bulkAdd(items);
        await db.stockMovements.bulkAdd(stockMovements);
        await db.products.bulkPut(productsToUpdate);
      },
    );
  },
};

export const stockMovementRepo = {
  async listRecent(limit = 50) {
    return db.stockMovements
      .orderBy("createdAt")
      .reverse()
      .limit(limit)
      .toArray();
  },

  async add(movement: StockMovement) {
    return db.stockMovements.add(movement);
  },
};

export const settingsRepo = {
  async init(): Promise<Settings> {
    if (!db.isOpen()) {
      await Promise.race([
        db.open(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("IndexedDB open timed out after 10 s. Your browser may be blocking local storage.")), 10_000)
        ),
      ]);
    }

    return db.transaction("rw", db.settings, async () => {
      const existing = await db.settings.get(SETTINGS_ID);

      if (existing) {
        return existing;
      }

      const defaults = buildDefaultSettings();
      await db.settings.put(defaults);
      return defaults;
    });
  },

  async get(): Promise<Settings | undefined> {
    return db.settings.get(SETTINGS_ID);
  },

  async update(changes: Partial<Settings>): Promise<Settings> {
    const current = await requireSettings();

    const next: Settings = {
      ...current,
      ...changes,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };

    await db.settings.put(next);
    return next;
  },

  async nextBillNumber(): Promise<number> {
    return db.transaction("rw", db.settings, async () => {
      const settings = await requireSettings();
      const sequence = settings.nextBillSequence;

      await db.settings.update(settings.id, {
        nextBillSequence: sequence + 1,
        updatedAt: new Date().toISOString(),
      });

      return sequence;
    });
  },
};

export const customerRepo = {
  async list(): Promise<Customer[]> {
    return db.customers.orderBy('name').toArray();
  },

  async findById(id: string): Promise<Customer | undefined> {
    return db.customers.get(id);
  },

  async findByNormalizedPhone(normalizedPhone: string): Promise<Customer | undefined> {
    if (!normalizedPhone) return undefined;
    return db.customers.where('normalizedPhone').equals(normalizedPhone).first();
  },

  /**
   * Look up an existing customer matching the given phone (if any) or
   * create a new one inside the current Dexie transaction. The caller is
   * responsible for queuing the sync job — this keeps the repo focused on
   * data shape and lets billing-service decide whether the bill creation
   * itself should also trigger a customer sync push.
   *
   * Returns the resolved Customer plus whether it was newly created and
   * whether an existing row was changed in place, so the caller can decide
   * whether (and how) to enqueue a 'customer' sync job.
   */
  async findOrCreate(input: {
    name?: string;
    phone?: string;
  }): Promise<{ customer: Customer; created: boolean; changed: boolean } | null> {
    const cleanName = input.name?.trim();
    const cleanPhone = input.phone?.trim();
    if (!cleanName && !cleanPhone) return null;

    const normalizedPhone = normalizePhone(cleanPhone);
    if (normalizedPhone) {
      const existing = await db.customers.where('normalizedPhone').equals(normalizedPhone).first();
      if (existing) {
        // Refresh name if the new bill supplied a non-empty one that differs.
        if (cleanName && cleanName !== existing.name) {
          const updated: Customer = {
            ...existing,
            name: cleanName,
            updatedAt: nowIso(),
            syncStatus: 'pending',
            lastSyncError: undefined,
          };
          await db.customers.put(updated);
          return { customer: updated, created: false, changed: true };
        }
        return { customer: existing, created: false, changed: false };
      }
    }

    const now = nowIso();
    const customer: Customer = {
      id: createId('cust'),
      name: cleanName || 'Customer',
      phone: cleanPhone || undefined,
      normalizedPhone: normalizedPhone || undefined,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
    };
    await db.customers.put(customer);
    return { customer, created: true, changed: false };
  },

  async save(customer: Customer): Promise<void> {
    await db.transaction('rw', [db.customers, db.syncQueue], async () => {
      const now = nowIso();
      const next: Customer = {
        ...customer,
        updatedAt: now,
        normalizedPhone: customer.phone ? normalizePhone(customer.phone) : undefined,
        syncStatus: 'pending',
        lastSyncError: undefined,
      };
      await db.customers.put(next);
      await db.syncQueue.put(buildSyncQueueItem({
        entity: 'customer',
        entityId: next.id,
        operation: 'upsert',
      }));
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('shopkeeper:sync-requested'));
    }
  },
};

// Supplier repo mirrors customerRepo exactly. Direction of money flow is
// inverted at higher layers (purchase-service, supplier ledger) — the table
// itself just stores name/phone the same way.
export const supplierRepo = {
  async list(): Promise<Supplier[]> {
    return db.suppliers.orderBy('name').toArray();
  },

  async findById(id: string): Promise<Supplier | undefined> {
    return db.suppliers.get(id);
  },

  async findByNormalizedPhone(normalizedPhone: string): Promise<Supplier | undefined> {
    if (!normalizedPhone) return undefined;
    return db.suppliers.where('normalizedPhone').equals(normalizedPhone).first();
  },

  /**
   * Mirrors customerRepo.findOrCreate. Caller is responsible for queuing the
   * sync job — purchase-service decides whether the purchase creation should
   * also trigger a supplier sync push (created or renamed).
   */
  async findOrCreate(input: {
    name?: string;
    phone?: string;
  }): Promise<{ supplier: Supplier; created: boolean; changed: boolean } | null> {
    const cleanName = input.name?.trim();
    const cleanPhone = input.phone?.trim();
    if (!cleanName && !cleanPhone) return null;

    const normalizedPhone = normalizePhone(cleanPhone);
    if (normalizedPhone) {
      const existing = await db.suppliers.where('normalizedPhone').equals(normalizedPhone).first();
      if (existing) {
        if (cleanName && cleanName !== existing.name) {
          const updated: Supplier = {
            ...existing,
            name: cleanName,
            updatedAt: nowIso(),
            syncStatus: 'pending',
            lastSyncError: undefined,
          };
          await db.suppliers.put(updated);
          return { supplier: updated, created: false, changed: true };
        }
        return { supplier: existing, created: false, changed: false };
      }
    }

    const now = nowIso();
    const supplier: Supplier = {
      id: createId('supp'),
      name: cleanName || 'Supplier',
      phone: cleanPhone || undefined,
      normalizedPhone: normalizedPhone || undefined,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
    };
    await db.suppliers.put(supplier);
    return { supplier, created: true, changed: false };
  },

  async save(supplier: Supplier): Promise<void> {
    await db.transaction('rw', [db.suppliers, db.syncQueue], async () => {
      const now = nowIso();
      const next: Supplier = {
        ...supplier,
        updatedAt: now,
        normalizedPhone: supplier.phone ? normalizePhone(supplier.phone) : undefined,
        syncStatus: 'pending',
        lastSyncError: undefined,
      };
      await db.suppliers.put(next);
      await db.syncQueue.put(buildSyncQueueItem({
        entity: 'supplier',
        entityId: next.id,
        operation: 'upsert',
      }));
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('shopkeeper:sync-requested'));
    }
  },
};

export async function clearAllData() {
  await Dexie.delete(db.name);
  window.location.reload();
}

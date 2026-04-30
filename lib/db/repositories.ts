import Dexie from "dexie";
import { db } from "./schema";
import type {
  Bill,
  BillItem,
  Product,
  Settings,
  StockMovement,
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

export async function clearAllData() {
  await Dexie.delete(db.name);
  window.location.reload();
}

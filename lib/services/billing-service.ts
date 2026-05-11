import { db } from "@/lib/db/schema";
import { SETTINGS_ID } from "@/lib/db/repositories";
import {
  calculateBillTotals,
  calculateChange,
  calculateLineProfit,
  calculateLineSubtotal,
} from "@/lib/utils/calculations";
import { nowIso } from "@/lib/utils/date";
import { createBillNumber, createId } from "@/lib/utils/id";
import { buildSyncQueueItem } from "@/lib/services/sync-queue-service";
import type {
  Bill,
  BillDraftItem,
  BillFormValues,
  BillItem,
  Product,
  Settings,
  StockMovement,
} from "@/types/domain";

function requestSync(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('shopkeeper:sync-requested'));
  }
}

function validateDraftLine(
  settings: Settings,
  line: BillDraftItem,
  product: Product,
) {
  if (product.status !== "active")
    throw new Error(`Product ${product.name} is inactive.`);
  if (line.quantity <= 0)
    throw new Error(`Quantity for ${product.name} must be greater than zero.`);
  if (line.quantity > product.quantityInStock)
    throw new Error(`Not enough stock for ${product.name}.`);
  if (!settings.allowLossSale && line.unitSellPrice < line.unitBuyPrice) {
    throw new Error(`Loss-making sale is not allowed for ${product.name}.`);
  }
}

export async function createFinalizedBill(input: {
  items: BillDraftItem[];
  form: BillFormValues;
}): Promise<{ bill: Bill; billItems: BillItem[] }> {
  if (input.items.length === 0) {
    throw new Error("Add at least one product before finalizing the bill.");
  }

  const totalAmountPreview = calculateBillTotals(
    input.items.map((item) => ({
      quantity: item.quantity,
      unitBuyPrice: item.unitBuyPrice,
      unitSellPrice: item.unitSellPrice,
    })),
    input.form.discountAmount,
    input.form.taxAmount,
  ).totalAmount;

  if (totalAmountPreview < 0) {
    throw new Error("Discount cannot be greater than subtotal plus tax.");
  }

  const isCreditSalePreview = input.form.paymentMethod === 'credit';
  if (isCreditSalePreview && !input.form.customerName?.trim() && !input.form.customerPhone?.trim()) {
    throw new Error('Customer name or phone is required for credit bills.');
  }
  if (!isCreditSalePreview && calculateChange(input.form.paidAmount, totalAmountPreview) < 0) {
    throw new Error("Paid amount is lower than bill total.");
  }

  const result = await db.transaction(
    "rw",
    [
      db.bills,
      db.billItems,
      db.products,
      db.stockMovements,
      db.settings,
      db.syncQueue,
    ],
    async () => {
      const settings = await db.settings.get(SETTINGS_ID);
      if (!settings) {
        throw new Error(
          "Settings row not found. Initialize settings before creating bills.",
        );
      }
      const productIds = input.items.map((item) => item.productId);
      const liveProducts = await db.products.bulkGet(productIds);

      if (liveProducts.some((product) => !product)) {
        throw new Error("Some products could not be found in inventory.");
      }

      const createdAt = nowIso();
      const sequence = settings.nextBillSequence;
      const billId = createId("bill");
      const billNumber = createBillNumber(sequence);
      const products = liveProducts as Product[];

      for (const line of input.items) {
        const product = products.find(
          (candidate) => candidate.id === line.productId,
        );
        if (!product) throw new Error(`Product ${line.name} not found.`);
        validateDraftLine(settings, line, product);
      }

      const billItems: BillItem[] = input.items.map((item) => ({
        id: createId("bill_item"),
        billId,
        originalProductId: item.productId,
        barcodeAtSale: item.barcode,
        productNameAtSale: item.name,
        categoryAtSale: item.category,
        quantitySold: item.quantity,
        unitBuyPriceAtSale: item.unitBuyPrice,
        unitSellPriceAtSale: item.unitSellPrice,
        lineSubtotal: calculateLineSubtotal(item.quantity, item.unitSellPrice),
        lineProfit: calculateLineProfit(
          item.quantity,
          item.unitBuyPrice,
          item.unitSellPrice,
        ),
        createdAt,
      }));

      const totals = calculateBillTotals(
        input.items.map((item) => ({
          quantity: item.quantity,
          unitBuyPrice: item.unitBuyPrice,
          unitSellPrice: item.unitSellPrice,
        })),
        input.form.discountAmount,
        input.form.taxAmount,
      );

      const totalAmount = totals.totalAmount;
      if (totalAmount < 0) {
        throw new Error("Discount cannot be greater than subtotal plus tax.");
      }
      const isCreditSale = input.form.paymentMethod === 'credit';
      if (isCreditSale && !input.form.customerName?.trim() && !input.form.customerPhone?.trim()) {
        throw new Error('Customer name or phone is required for credit bills.');
      }
      const changeAmount = calculateChange(input.form.paidAmount, totalAmount);
      if (!isCreditSale && changeAmount < 0) {
        throw new Error("Paid amount is lower than bill total.");
      }
      const safeChangeAmount = isCreditSale ? Math.max(0, changeAmount) : changeAmount;

      const bill: Bill = {
        id: billId,
        billNumber,
        createdAt,
        cashierName: input.form.cashierName,
        customerName: input.form.customerName,
        customerPhone: input.form.customerPhone,
        paymentMethod: input.form.paymentMethod,
        subtotal: totals.subtotal,
        discountAmount: input.form.discountAmount,
        taxAmount: input.form.taxAmount,
        totalAmount,
        paidAmount: input.form.paidAmount,
        changeAmount: safeChangeAmount,
        totalProfit: totals.totalProfit,
        itemCount: input.items.reduce((sum, item) => sum + item.quantity, 0),
        status: "finalized",
        notes: input.form.notes,
        syncStatus: "pending",
      };

      const updatedProducts: Product[] = products.map((product) => {
        const soldLines = input.items.filter(
          (item) => item.productId === product.id,
        );
        if (soldLines.length === 0) return product;

        const totalSold = soldLines.reduce(
          (sum, line) => sum + line.quantity,
          0,
        );
        return {
          ...product,
          quantityInStock: product.quantityInStock - totalSold,
          lastUpdated: createdAt,
          syncStatus: "pending",
          lastSyncError: undefined,
        };
      });

      const stockMovements: StockMovement[] = input.items.map((item) => ({
        id: createId("move"),
        productId: item.productId,
        movementType: "sale",
        quantityChange: -item.quantity,
        referenceType: "bill",
        referenceId: billId,
        note: `Sale recorded in ${billNumber}`,
        createdAt,
        syncStatus: "pending",
      }));

      await db.bills.add(bill);
      await db.billItems.bulkAdd(billItems);
      await db.products.bulkPut(updatedProducts);
      await db.stockMovements.bulkAdd(stockMovements);
      await db.settings.update(settings.id, {
        nextBillSequence: sequence + 1,
        updatedAt: createdAt,
        syncStatus: "pending",
        lastSyncError: undefined,
      });

      await db.syncQueue.bulkPut([
        buildSyncQueueItem({
          entity: "bill",
          entityId: bill.id,
          operation: "create",
        }),
        buildSyncQueueItem({
          entity: "settings",
          entityId: settings.id,
          operation: "upsert",
        }),
        ...stockMovements.map((movement) =>
          buildSyncQueueItem({
            entity: "stockMovement",
            entityId: movement.id,
            operation: "create",
          }),
        ),
      ]);

      return { bill, billItems };
    },
  );

  requestSync();
  return result;
}

function appendBillNote(existing: string | undefined, note: string): string {
  return existing ? `${existing}\n${note}` : note;
}

function calculateReturnedLineValue(item: BillItem, quantity: number) {
  return {
    amount: calculateLineSubtotal(quantity, item.unitSellPriceAtSale),
    profit: calculateLineProfit(
      quantity,
      item.unitBuyPriceAtSale,
      item.unitSellPriceAtSale,
    ),
  };
}

function getRemainingItemQuantity(item: BillItem): number {
  return Math.max(0, item.quantitySold - (item.quantityReturned ?? 0));
}

export async function voidBill(input: {
  billId: string;
  reason: string;
}): Promise<void> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Void reason is required.");

  await db.transaction(
    "rw",
    [db.bills, db.billItems, db.products, db.stockMovements, db.syncQueue],
    async () => {
      const bill = await db.bills.get(input.billId);
      if (!bill) throw new Error("Bill not found.");
      if (bill.status === "voided") throw new Error("Bill is already voided.");
      if (bill.status !== "finalized")
        throw new Error("Only finalized bills can be voided.");

      const items = await db.billItems
        .where("billId")
        .equals(input.billId)
        .toArray();
      const now = nowIso();
      const productIds = Array.from(
        new Set(items.map((item) => item.originalProductId)),
      );
      const products = (await db.products.bulkGet(productIds)).filter(
        (product): product is Product => Boolean(product),
      );

      const updatedProducts: Product[] = products.map((product) => {
        const restoreQuantity = items
          .filter((item) => item.originalProductId === product.id)
          .reduce((sum, item) => sum + getRemainingItemQuantity(item), 0);

        if (restoreQuantity <= 0) return product;
        return {
          ...product,
          quantityInStock: product.quantityInStock + restoreQuantity,
          lastUpdated: now,
          syncStatus: "pending",
          lastSyncError: undefined,
        };
      });

      const stockMovements: StockMovement[] = items.flatMap((item) => {
        const quantityToRestore = getRemainingItemQuantity(item);
        if (quantityToRestore <= 0) return [];
        return [
          {
            id: createId("move"),
            productId: item.originalProductId,
            movementType: "return",
            quantityChange: quantityToRestore,
            referenceType: "bill",
            referenceId: bill.id,
            note: `Void ${bill.billNumber}: ${reason}`,
            createdAt: now,
            syncStatus: "pending",
          } satisfies StockMovement,
        ];
      });

      const fullyReturnedItems = items.map((item) => ({
        ...item,
        quantityReturned: item.quantitySold,
      }));

      await db.billItems.bulkPut(fullyReturnedItems);
      await db.products.bulkPut(updatedProducts);
      if (stockMovements.length > 0)
        await db.stockMovements.bulkAdd(stockMovements);
      await db.bills.update(bill.id, {
        status: "voided",
        voidedAt: now,
        voidReason: reason,
        returnedAmount: bill.totalAmount,
        returnedProfit: bill.totalProfit,
        lastReturnAt: now,
        lastReturnReason: reason,
        notes: appendBillNote(bill.notes, `Voided: ${reason}`),
        syncStatus: "pending",
        lastSyncError: undefined,
      });

      await db.syncQueue.bulkPut([
        buildSyncQueueItem({
          entity: "bill",
          entityId: bill.id,
          operation: "update",
        }),
        ...stockMovements.map((movement) =>
          buildSyncQueueItem({
            entity: "stockMovement",
            entityId: movement.id,
            operation: "create",
          }),
        ),
      ]);
    },
  );
}

export async function returnBillItem(input: {
  billId: string;
  itemId: string;
  quantity: number;
  reason: string;
}): Promise<void> {
  const reason = input.reason.trim();
  const quantity = Number(input.quantity);
  if (!reason) throw new Error("Return reason is required.");
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw new Error("Return quantity must be greater than zero.");

  await db.transaction(
    "rw",
    [db.bills, db.billItems, db.products, db.stockMovements, db.syncQueue],
    async () => {
      const [bill, item] = await Promise.all([
        db.bills.get(input.billId),
        db.billItems.get(input.itemId),
      ]);

      if (!bill) throw new Error("Bill not found.");
      if (!item || item.billId !== bill.id)
        throw new Error("Bill item not found.");
      if (bill.status === "voided")
        throw new Error("Voided bills cannot receive returns.");

      const remainingQuantity = getRemainingItemQuantity(item);
      if (quantity > remainingQuantity)
        throw new Error(
          "Return quantity is higher than the remaining sold quantity.",
        );

      const product = await db.products.get(item.originalProductId);
      if (!product) throw new Error("Product not found.");

      const now = nowIso();
      const returnedValues = calculateReturnedLineValue(item, quantity);
      const nextReturnedQuantity = (item.quantityReturned ?? 0) + quantity;
      await db.billItems.update(item.id, {
        quantityReturned: nextReturnedQuantity,
      });

      const allItems = await db.billItems
        .where("billId")
        .equals(bill.id)
        .toArray();
      const nextItems = allItems.map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, quantityReturned: nextReturnedQuantity }
          : candidate,
      );
      const allReturned = nextItems.every(
        (candidate) => getRemainingItemQuantity(candidate) <= 0,
      );

      const nextReturnedAmount =
        (bill.returnedAmount ?? 0) + returnedValues.amount;
      const nextReturnedProfit =
        (bill.returnedProfit ?? 0) + returnedValues.profit;

      const stockMovement: StockMovement = {
        id: createId("move"),
        productId: item.originalProductId,
        movementType: "return",
        quantityChange: quantity,
        referenceType: "bill",
        referenceId: bill.id,
        note: `Return ${bill.billNumber} / ${item.productNameAtSale}: ${reason}`,
        createdAt: now,
        syncStatus: "pending",
      };

      await db.products.put({
        ...product,
        quantityInStock: product.quantityInStock + quantity,
        lastUpdated: now,
        syncStatus: "pending",
        lastSyncError: undefined,
      });
      await db.stockMovements.add(stockMovement);
      await db.bills.update(bill.id, {
        status: allReturned ? "returned" : "partially_returned",
        returnedAmount: nextReturnedAmount,
        returnedProfit: nextReturnedProfit,
        lastReturnAt: now,
        lastReturnReason: reason,
        notes: appendBillNote(
          bill.notes,
          `Returned ${quantity} × ${item.productNameAtSale}: ${reason}`,
        ),
        syncStatus: "pending",
        lastSyncError: undefined,
      });

      await db.syncQueue.bulkPut([
        buildSyncQueueItem({
          entity: "bill",
          entityId: bill.id,
          operation: "update",
        }),
        buildSyncQueueItem({
          entity: "stockMovement",
          entityId: stockMovement.id,
          operation: "create",
        }),
      ]);
    },
  );
}

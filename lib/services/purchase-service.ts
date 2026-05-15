import { db } from "@/lib/db/schema";
import { SETTINGS_ID, supplierRepo } from "@/lib/db/repositories";
import { calculateBillTotals, calculateChange, calculateLineSubtotal } from "@/lib/utils/calculations";
import { nowIso } from "@/lib/utils/date";
import { addMoney, allocateMoney, roundMoney, subtractMoney } from "@/lib/utils/money";
import { createId, createPurchaseNumber } from "@/lib/utils/id";
import { buildSyncQueueItem, getSyncQueueId } from "@/lib/services/sync-queue-service";
import type { BillSplit } from "@/lib/utils/bill-split";
import type {
  PaymentMethod,
  Product,
  Purchase,
  PurchaseDraftItem,
  PurchaseFormValues,
  PurchaseItem,
  Settings,
  StockMovement,
} from "@/types/domain";

function requestSync(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("shopkeeper:sync-requested"));
  }
}

function validatePurchaseLine(line: PurchaseDraftItem, product: Product) {
  if (product.status !== "active") {
    throw new Error(`Product ${product.name} is inactive.`);
  }
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    throw new Error(
      `Quantity for ${product.name} must be a positive whole number.`,
    );
  }
  if (!Number.isFinite(line.unitCost) || line.unitCost < 0) {
    throw new Error(`Unit cost for ${product.name} cannot be negative.`);
  }
}

/**
 * Derive the cash/card/credit split for a finalized purchase. Mirror of the
 * billing-service helper, with one semantic flip: for purchases, creditAmount
 * represents what we OWE the supplier (a payable), not what the customer
 * owes us. The invariant stays the same:
 *
 *   cashAmount + cardAmount + creditAmount === totalAmount
 *
 * Mixed purchases must provide an explicit cash/card split that sums to
 * total. Pure-cash purchases support "we handed over more than the bill"
 * (paidAmount > total) with a change amount, mirroring the cashier flow.
 */
function derivePurchaseSplit(
  paymentMethod: PaymentMethod,
  form: PurchaseFormValues,
  totalAmount: number,
): BillSplit & { paidAmount: number; changeAmount: number } {
  const total = roundMoney(totalAmount);
  switch (paymentMethod) {
    case "cash": {
      const tendered = Math.max(0, Number(form.paidAmount) || 0);
      const cashAmount = Math.min(tendered, total);
      return {
        cashAmount,
        cardAmount: 0,
        creditAmount: 0,
        paidAmount: tendered,
        changeAmount: Math.max(0, tendered - total),
      };
    }
    case "card":
      return {
        cashAmount: 0,
        cardAmount: total,
        creditAmount: 0,
        paidAmount: total,
        changeAmount: 0,
      };
    case "credit": {
      const deposit = Math.max(0, Math.min(Number(form.paidAmount) || 0, total));
      return {
        cashAmount: deposit,
        cardAmount: 0,
        creditAmount: roundMoney(total - deposit),
        paidAmount: deposit,
        changeAmount: 0,
      };
    }
    case "mixed": {
      const cashAmount = roundMoney(Math.max(0, Number(form.cashAmount) || 0));
      const cardAmount = roundMoney(Math.max(0, Number(form.cardAmount) || 0));
      if (Math.abs(cashAmount + cardAmount - total) > 0.005) {
        throw new Error("Mixed payment cash + card must equal purchase total.");
      }
      return {
        cashAmount,
        cardAmount,
        creditAmount: 0,
        paidAmount: roundMoney(cashAmount + cardAmount),
        changeAmount: 0,
      };
    }
  }
}

export async function createFinalizedPurchase(input: {
  items: PurchaseDraftItem[];
  form: PurchaseFormValues;
}): Promise<{ purchase: Purchase; purchaseItems: PurchaseItem[] }> {
  if (input.items.length === 0) {
    throw new Error("Add at least one product before saving the purchase.");
  }

  const totalAmountPreview = calculateBillTotals(
    input.items.map((item) => ({
      quantity: item.quantity,
      // For purchase totals, "unitBuyPrice" semantically equals our cost.
      // We pass it as both buy and sell because calculateBillTotals doesn't
      // care — it only uses sell-price for subtotal math.
      unitBuyPrice: item.unitCost,
      unitSellPrice: item.unitCost,
    })),
    input.form.discountAmount,
    input.form.taxAmount,
  ).totalAmount;

  if (totalAmountPreview < 0) {
    throw new Error("Discount cannot be greater than subtotal plus tax.");
  }

  // Pre-transaction validation: cash and mixed must satisfy their split
  // invariants before we open the transaction.
  if (
    input.form.paymentMethod === "cash" &&
    calculateChange(input.form.paidAmount, totalAmountPreview) < 0
  ) {
    throw new Error("Paid amount is lower than the purchase total.");
  }
  if (input.form.paymentMethod === "mixed") {
    const c = Math.max(0, Number(input.form.cashAmount) || 0);
    const k = Math.max(0, Number(input.form.cardAmount) || 0);
    if (Math.abs(c + k - totalAmountPreview) > 0.005) {
      throw new Error("Mixed payment cash + card must equal purchase total.");
    }
  }
  const isCreditPurchase = input.form.paymentMethod === "credit";
  if (
    isCreditPurchase &&
    !input.form.supplierName?.trim() &&
    !input.form.supplierPhone?.trim()
  ) {
    throw new Error("Supplier name or phone is required for credit purchases.");
  }

  const result = await db.transaction(
    "rw",
    [
      db.purchases,
      db.purchaseItems,
      db.products,
      db.stockMovements,
      db.settings,
      db.suppliers,
      db.shifts,
      db.syncQueue,
    ],
    async () => {
      const settings = await db.settings.get(SETTINGS_ID);
      if (!settings) {
        throw new Error(
          "Settings row not found. Initialize settings before creating purchases.",
        );
      }

      const productIds = input.items.map((item) => item.productId);
      const liveProducts = await db.products.bulkGet(productIds);
      if (liveProducts.some((product) => !product)) {
        throw new Error("Some products could not be found in inventory.");
      }
      const products = liveProducts as Product[];

      for (const line of input.items) {
        const product = products.find((p) => p.id === line.productId);
        if (!product) throw new Error(`Product ${line.name} not found.`);
        validatePurchaseLine(line, product);
      }

      const createdAt = nowIso();
      // Share Settings.nextBillSequence with bills — PO numbers and INV
      // numbers come from the same monotonic counter, which means the human-
      // readable numbers are unique but not sequential within a single
      // document type. A future migration can split sequences if accountants
      // need pure per-type numbering.
      const sequence = settings.nextBillSequence;
      const purchaseId = createId("purchase");
      const purchaseNumber = createPurchaseNumber(sequence);

      const totals = calculateBillTotals(
        input.items.map((item) => ({
          quantity: item.quantity,
          unitBuyPrice: item.unitCost,
          unitSellPrice: item.unitCost,
        })),
        input.form.discountAmount,
        input.form.taxAmount,
      );

      const totalAmount = totals.totalAmount;
      if (totalAmount < 0) {
        throw new Error("Discount cannot be greater than subtotal plus tax.");
      }

      const split = derivePurchaseSplit(input.form.paymentMethod, input.form, totalAmount);

      // Resolve the supplier within the same transaction. Mirror of the
      // customer resolution path in billing-service.
      let resolvedSupplierId: string | undefined;
      let supplierResolution: Awaited<ReturnType<typeof supplierRepo.findOrCreate>> = null;
      supplierResolution = await supplierRepo.findOrCreate({
        name: input.form.supplierName,
        phone: input.form.supplierPhone,
      });
      if (supplierResolution) {
        resolvedSupplierId = supplierResolution.supplier.id;
      }

      // Tag with active shift if one is open so the cash portion subtracts
      // from drawer expected cash at close.
      const activeShift = await db.shifts.where("status").equals("open").first();
      const resolvedShiftId = activeShift?.id;

      const purchaseItems: PurchaseItem[] = input.items.map((item) => ({
        id: createId("purchase_item"),
        purchaseId,
        originalProductId: item.productId,
        barcodeAtPurchase: item.barcode,
        productNameAtPurchase: item.name,
        categoryAtPurchase: item.category,
        quantityPurchased: item.quantity,
        unitCostAtPurchase: item.unitCost,
        lineSubtotal: calculateLineSubtotal(item.quantity, item.unitCost),
        createdAt,
      }));

      const purchase: Purchase = {
        id: purchaseId,
        purchaseNumber,
        createdAt,
        cashierName: input.form.cashierName,
        supplierId: resolvedSupplierId,
        supplierName: input.form.supplierName,
        supplierPhone: input.form.supplierPhone,
        paymentMethod: input.form.paymentMethod,
        subtotal: totals.subtotal,
        discountAmount: input.form.discountAmount,
        taxAmount: input.form.taxAmount,
        totalAmount,
        paidAmount: split.paidAmount,
        changeAmount: split.changeAmount,
        cashAmount: split.cashAmount,
        cardAmount: split.cardAmount,
        creditAmount: split.creditAmount,
        itemCount: input.items.reduce((sum, item) => sum + item.quantity, 0),
        status: "finalized",
        shiftId: resolvedShiftId,
        notes: input.form.notes,
        syncStatus: "pending",
      };

      // INCREASE stock and update buyPrice for each purchased product. The
      // existing inventory model uses "latest cost wins" so future bills
      // compute profit against the current buy price.
      const updatedProducts: Product[] = products.map((product) => {
        const purchasedLines = input.items.filter((i) => i.productId === product.id);
        if (purchasedLines.length === 0) return product;
        const totalQty = purchasedLines.reduce((sum, line) => sum + line.quantity, 0);
        // If multiple lines reference the same product with different costs,
        // use the latest line's cost as the new buyPrice. Edge case but
        // possible if the cashier accidentally entered two lines.
        const latestCost = purchasedLines[purchasedLines.length - 1].unitCost;
        return {
          ...product,
          quantityInStock: product.quantityInStock + totalQty,
          buyPrice: latestCost,
          lastUpdated: createdAt,
          syncStatus: "pending",
          lastSyncError: undefined,
        };
      });

      const stockMovements: StockMovement[] = input.items.map((item) => ({
        id: createId("move"),
        productId: item.productId,
        movementType: "purchase",
        quantityChange: item.quantity,
        referenceType: "adjustment",
        referenceId: purchaseId,
        note: `Purchase ${purchaseNumber}${input.form.supplierName ? ` from ${input.form.supplierName}` : ""}`,
        createdAt,
        syncStatus: "pending",
      }));

      await db.purchases.add(purchase);
      await db.purchaseItems.bulkAdd(purchaseItems);
      await db.products.bulkPut(updatedProducts);
      await db.stockMovements.bulkAdd(stockMovements);
      await db.settings.update(settings.id, {
        nextBillSequence: sequence + 1,
        updatedAt: createdAt,
        syncStatus: "pending",
        lastSyncError: undefined,
      });

      const settingsJobId = getSyncQueueId("settings", settings.id);
      const existingSettingsJob = await db.syncQueue.get(settingsJobId);
      const existingSettingsSource =
        (existingSettingsJob?.payload as { source?: string } | undefined)?.source;
      const isExistingSettingsActive =
        existingSettingsJob &&
        existingSettingsJob.status !== "synced" &&
        existingSettingsSource !== "bill-sequence";

      const syncJobs = [
        buildSyncQueueItem({
          entity: "purchase",
          entityId: purchase.id,
          operation: "create",
        }),
        buildSyncQueueItem(
          {
            entity: "settings",
            entityId: settings.id,
            operation: "upsert",
            payload: isExistingSettingsActive
              ? existingSettingsJob?.payload
              : { source: "bill-sequence" },
          },
          existingSettingsJob,
        ),
        ...stockMovements.map((movement) =>
          buildSyncQueueItem({
            entity: "stockMovement",
            entityId: movement.id,
            operation: "create",
          }),
        ),
      ];

      if (supplierResolution?.created || supplierResolution?.changed) {
        syncJobs.push(
          buildSyncQueueItem({
            entity: "supplier",
            entityId: supplierResolution.supplier.id,
            operation: supplierResolution.created ? "create" : "upsert",
          }),
        );
      }

      await db.syncQueue.bulkPut(syncJobs);

      return { purchase, purchaseItems };
    },
  );

  requestSync();
  return result;
}

function appendPurchaseNote(existing: string | undefined, note: string): string {
  return existing ? `${existing}\n${note}` : note;
}

function calculateReturnedPurchaseLineValue(
  purchase: Purchase,
  item: PurchaseItem,
  quantity: number,
) {
  const lineAmount = calculateLineSubtotal(quantity, item.unitCostAtPurchase);
  const subtotalRatio = purchase.subtotal > 0 ? lineAmount / purchase.subtotal : 0;
  const discountShare = allocateMoney(purchase.discountAmount, subtotalRatio);
  const taxShare = allocateMoney(purchase.taxAmount, subtotalRatio);
  return addMoney(subtractMoney(lineAmount, discountShare), taxShare);
}

function getRemainingPurchaseItemQuantity(item: PurchaseItem): number {
  return Math.max(0, item.quantityPurchased - (item.quantityReturned ?? 0));
}

/**
 * Void a purchase — reverse the stock add and mark the purchase voided.
 * Mirror of voidBill, but stock direction flips: a void on the buy side
 * REMOVES inventory that was added by the purchase.
 */
export async function voidPurchase(input: {
  purchaseId: string;
  reason: string;
}): Promise<void> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Void reason is required.");

  await db.transaction(
    "rw",
    [db.purchases, db.purchaseItems, db.products, db.stockMovements, db.syncQueue],
    async () => {
      const purchase = await db.purchases.get(input.purchaseId);
      if (!purchase) throw new Error("Purchase not found.");
      if (purchase.status === "voided") {
        throw new Error("Purchase is already voided.");
      }
      if (purchase.status !== "finalized") {
        throw new Error("Only finalized purchases can be voided.");
      }

      const items = await db.purchaseItems
        .where("purchaseId")
        .equals(input.purchaseId)
        .toArray();
      const now = nowIso();
      const productIds = Array.from(
        new Set(items.map((item) => item.originalProductId)),
      );
      const products = (await db.products.bulkGet(productIds)).filter(
        (product): product is Product => Boolean(product),
      );

      const updatedProducts: Product[] = products.map((product) => {
        const removeQuantity = items
          .filter((item) => item.originalProductId === product.id)
          .reduce((sum, item) => sum + getRemainingPurchaseItemQuantity(item), 0);
        if (removeQuantity <= 0) return product;
        // Edge case: stock may already be lower than what we'd remove if
        // some of the purchased units were sold or adjusted out. Clamp to 0
        // so we never produce negative inventory.
        const nextQty = Math.max(0, product.quantityInStock - removeQuantity);
        return {
          ...product,
          quantityInStock: nextQty,
          lastUpdated: now,
          syncStatus: "pending",
          lastSyncError: undefined,
        };
      });

      const stockMovements: StockMovement[] = items.flatMap((item) => {
        const qty = getRemainingPurchaseItemQuantity(item);
        if (qty <= 0) return [];
        return [
          {
            id: createId("move"),
            productId: item.originalProductId,
            movementType: "adjustment",
            quantityChange: -qty,
            referenceType: "adjustment",
            referenceId: purchase.id,
            note: `Void purchase ${purchase.purchaseNumber}: ${reason}`,
            createdAt: now,
            syncStatus: "pending",
          } satisfies StockMovement,
        ];
      });

      const fullyReturnedItems = items.map((item) => ({
        ...item,
        quantityReturned: item.quantityPurchased,
      }));

      await db.purchaseItems.bulkPut(fullyReturnedItems);
      await db.products.bulkPut(updatedProducts);
      if (stockMovements.length > 0) {
        await db.stockMovements.bulkAdd(stockMovements);
      }
      await db.purchases.update(purchase.id, {
        status: "voided",
        voidedAt: now,
        voidReason: reason,
        returnedAmount: purchase.totalAmount,
        lastReturnAt: now,
        lastReturnReason: reason,
        notes: appendPurchaseNote(purchase.notes, `Voided: ${reason}`),
        syncStatus: "pending",
        lastSyncError: undefined,
      });

      await db.syncQueue.bulkPut([
        buildSyncQueueItem({
          entity: "purchase",
          entityId: purchase.id,
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
  requestSync();
}

/**
 * Return a quantity of one purchase item back to the supplier. Mirror of
 * returnBillItem with direction inverted: stock LEAVES, supplier's payable
 * is reduced.
 */
export async function returnPurchaseItem(input: {
  purchaseId: string;
  itemId: string;
  quantity: number;
  reason: string;
}): Promise<void> {
  const reason = input.reason.trim();
  const quantity = Number(input.quantity);
  if (!reason) throw new Error("Return reason is required.");
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Return quantity must be a positive whole number.");
  }

  await db.transaction(
    "rw",
    [db.purchases, db.purchaseItems, db.products, db.stockMovements, db.syncQueue],
    async () => {
      const [purchase, item] = await Promise.all([
        db.purchases.get(input.purchaseId),
        db.purchaseItems.get(input.itemId),
      ]);
      if (!purchase) throw new Error("Purchase not found.");
      if (!item || item.purchaseId !== purchase.id) {
        throw new Error("Purchase item not found.");
      }
      if (purchase.status === "voided") {
        throw new Error("Voided purchases cannot receive returns.");
      }

      const remainingQuantity = getRemainingPurchaseItemQuantity(item);
      if (quantity > remainingQuantity) {
        throw new Error(
          "Return quantity is higher than the remaining purchased quantity.",
        );
      }

      const product = await db.products.get(item.originalProductId);
      if (!product) throw new Error("Product not found.");
      if (product.quantityInStock < quantity) {
        throw new Error(
          "Not enough stock to return — some units were sold or adjusted out already.",
        );
      }

      const now = nowIso();
      const returnedAmount = calculateReturnedPurchaseLineValue(purchase, item, quantity);
      const nextReturnedQuantity = (item.quantityReturned ?? 0) + quantity;
      await db.purchaseItems.update(item.id, {
        quantityReturned: nextReturnedQuantity,
      });

      const allItems = await db.purchaseItems
        .where("purchaseId")
        .equals(purchase.id)
        .toArray();
      const nextItems = allItems.map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, quantityReturned: nextReturnedQuantity }
          : candidate,
      );
      const allReturned = nextItems.every(
        (candidate) => getRemainingPurchaseItemQuantity(candidate) <= 0,
      );

      const calculatedReturnedAmount = addMoney(
        purchase.returnedAmount ?? 0,
        returnedAmount,
      );
      const nextReturnedAmount = allReturned
        ? purchase.totalAmount
        : roundMoney(calculatedReturnedAmount);

      const stockMovement: StockMovement = {
        id: createId("move"),
        productId: item.originalProductId,
        movementType: "adjustment",
        quantityChange: -quantity,
        referenceType: "adjustment",
        referenceId: purchase.id,
        note: `Return to supplier ${purchase.purchaseNumber} / ${item.productNameAtPurchase}: ${reason}`,
        createdAt: now,
        syncStatus: "pending",
      };

      await db.products.put({
        ...product,
        quantityInStock: product.quantityInStock - quantity,
        lastUpdated: now,
        syncStatus: "pending",
        lastSyncError: undefined,
      });
      await db.stockMovements.add(stockMovement);
      await db.purchases.update(purchase.id, {
        status: allReturned ? "returned" : "partially_returned",
        returnedAmount: nextReturnedAmount,
        lastReturnAt: now,
        lastReturnReason: reason,
        notes: appendPurchaseNote(
          purchase.notes,
          `Returned ${quantity} × ${item.productNameAtPurchase}: ${reason}`,
        ),
        syncStatus: "pending",
        lastSyncError: undefined,
      });

      await db.syncQueue.bulkPut([
        buildSyncQueueItem({
          entity: "purchase",
          entityId: purchase.id,
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
  requestSync();
}

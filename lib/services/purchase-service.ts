import { AppError, AppErrorCode } from '@/lib/errors/app-error';
import { db } from "@/lib/db/schema";
import { logAudit } from "@/lib/services/audit-service";
import { SETTINGS_ID, supplierRepo } from "@/lib/db/repositories";
import { calculateBillTotals, calculateChange, calculateLineSubtotal } from "@/lib/utils/calculations";
import { assertPaymentMethodEnabled, effectiveTaxAmount } from "@/lib/services/settings-policy";
import { nowIso } from "@/lib/utils/date";
import { MONEY_EPSILON, addMoney, allocateMoney, roundMoney, subtractMoney } from "@/lib/utils/money";
import { createId, createPurchaseNumber } from "@/lib/utils/id";
import { buildSyncQueueItem, getSyncQueueId } from "@/lib/services/sync-queue-service";
import { isMiscLine } from "@/lib/utils/misc-items";
import type { BillSplit } from "@/lib/utils/bill-split";
import { assertSubscriptionCanWrite } from '@/lib/services/subscription-service';
import {
  createPurchaseLots,
  removePurchaseLotQuantity,
} from "@/lib/services/inventory-lot-service";
import { kgToGrams, pricingQuantityFor } from "@/lib/utils/weight";
import type {
  LotBaseUnit,
  PaymentMethod,
  Product,
  Purchase,
  PurchaseDraftItem,
  PurchaseFormValues,
  PurchaseItem,
  StockMovement,
} from "@/types/domain";

/**
 * Resolve a purchase draft line into the two quantity views the rest of the
 * service needs: `baseQuantity` (integer grams for weight, pieces otherwise —
 * what stock, lots, and movements use) and `pricingQuantity` (kilograms for
 * weight, pieces otherwise — the multiplier for per-kg / per-piece money).
 * Misc and unit lines collapse to identical base/pricing values.
 */
function resolvePurchaseLine(line: PurchaseDraftItem): {
  isWeight: boolean;
  baseUnit: LotBaseUnit;
  baseQuantity: number;
  pricingQuantity: number;
} {
  const isWeight = line.saleType === 'weight';
  const baseQuantity = isWeight
    ? Math.round(line.baseQuantity ?? kgToGrams(line.quantity))
    : line.quantity;
  return {
    isWeight,
    baseUnit: isWeight ? 'gram' : 'piece',
    baseQuantity,
    pricingQuantity: line.quantity,
  };
}

function requestSync(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("shopkeeper:sync-requested"));
  }
}

function validatePurchaseLine(line: PurchaseDraftItem, product: Product) {
  if (product.status !== "active") {
    throw new AppError(AppErrorCode.PRODUCT_INACTIVE, { name: product.name });
  }
  const { isWeight, baseQuantity } = resolvePurchaseLine(line);
  if (isWeight) {
    // Weight lines buy grams (integer base units); kg input is converted up
    // front, so a sub-gram or zero quantity is rejected here.
    if (!Number.isInteger(baseQuantity) || baseQuantity <= 0) {
      throw new AppError(AppErrorCode.PRODUCT_QTY_POSITIVE_WHOLE, { name: product.name });
    }
  } else if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    throw new AppError(AppErrorCode.PRODUCT_QTY_POSITIVE_WHOLE, { name: product.name });
  }
  if (!Number.isFinite(line.unitCost) || line.unitCost < 0) {
    throw new AppError(AppErrorCode.PRODUCT_UNIT_COST_NEGATIVE, { name: product.name });
  }
}

/**
 * Validate an ad-hoc متفرقات (misc) purchase line. Misc purchase lines have
 * no product behind them — they're a general purchase cost — so they only
 * need a positive whole quantity and a non-negative cost.
 */
function validateMiscPurchaseLine(line: PurchaseDraftItem) {
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    throw new AppError(AppErrorCode.PRODUCT_QTY_POSITIVE_WHOLE, { name: line.name });
  }
  if (!Number.isFinite(line.unitCost) || line.unitCost < 0) {
    throw new AppError(AppErrorCode.PRODUCT_UNIT_COST_NEGATIVE, { name: line.name });
  }
}

async function assertShiftStillEditable(shiftId?: string): Promise<void> {
  if (!shiftId) return;
  const shift = await db.shifts.get(shiftId);
  if (shift?.status === 'closed') {
    throw new AppError(AppErrorCode.CLOSED_SHIFT_RECORD_LOCKED);
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
 * Mixed payment is retired. Old mixed purchases remain readable through
 * normalizeBillSplit(), but new purchases cannot be created with paymentMethod
 * 'mixed'. Pure-cash purchases support overpayment/change.
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
    case "mixed":
      throw new AppError(AppErrorCode.PAYMENT_METHOD_DISABLED);
  }
}

export async function createFinalizedPurchase(input: {
  items: PurchaseDraftItem[];
  form: PurchaseFormValues;
}): Promise<{ purchase: Purchase; purchaseItems: PurchaseItem[] }> {
  await assertSubscriptionCanWrite();
  if (input.items.length === 0) {
    throw new AppError(AppErrorCode.PURCHASE_NO_ITEMS);
  }

  // Normalise tax up front so the pre-transaction payment checks use the same
  // total the transaction commits (a stale client could otherwise send tax
  // under a non-"exclusive" mode and trip a false PURCHASE_PAID_TOO_LOW /
  // PURCHASE_MIXED_SPLIT_MISMATCH). The transaction re-reads settings as the
  // authoritative copy.
  const previewSettings = await db.settings.get(SETTINGS_ID);
  const previewTaxAmount = previewSettings
    ? effectiveTaxAmount(previewSettings, input.form.taxAmount)
    : input.form.taxAmount;

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
    previewTaxAmount,
  ).totalAmount;

  if (totalAmountPreview < 0) {
    throw new AppError(AppErrorCode.DISCOUNT_TOO_HIGH);
  }

  // Pre-transaction validation: cash must have enough tendered money before
  // we open the transaction. Mixed payment is retired and rejected.
  if (
    input.form.paymentMethod === "cash" &&
    calculateChange(input.form.paidAmount, totalAmountPreview) < 0
  ) {
    throw new AppError(AppErrorCode.PURCHASE_PAID_TOO_LOW);
  }
  if (input.form.paymentMethod === "mixed") {
    throw new AppError(AppErrorCode.PAYMENT_METHOD_DISABLED);
  }
  const isCreditPurchase = input.form.paymentMethod === "credit";
  if (
    isCreditPurchase &&
    !input.form.supplierName?.trim() &&
    !input.form.supplierPhone?.trim()
  ) {
    throw new AppError(AppErrorCode.PURCHASE_CREDIT_NEEDS_SUPPLIER);
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
      db.inventoryLots,
    ],
    async () => {
      const settings = await db.settings.get(SETTINGS_ID);
      if (!settings) {
        throw new Error(
          "Settings row not found. Initialize settings before creating purchases.",
        );
      }

      // Settings-driven rules (authoritative copy of the purchase UI gates).
      assertPaymentMethodEnabled(settings, input.form.paymentMethod);
      const taxAmount = effectiveTaxAmount(settings, input.form.taxAmount);

      // Only real product lines hit inventory; misc (متفرقات) purchase lines
      // are a general cost with no product to look up or restock.
      const stockItems = input.items.filter((item) => !isMiscLine(item));
      const productIds = Array.from(new Set(stockItems.map((item) => item.productId)));
      const liveProducts = productIds.length > 0 ? await db.products.bulkGet(productIds) : [];
      if (liveProducts.some((product) => !product)) {
        throw new AppError(AppErrorCode.PRODUCTS_MISSING);
      }
      const products = liveProducts as Product[];

      for (const line of input.items) {
        if (isMiscLine(line)) {
          validateMiscPurchaseLine(line);
          continue;
        }
        const product = products.find((p) => p.id === line.productId);
        if (!product) throw new AppError(AppErrorCode.LINE_PRODUCT_NOT_FOUND, { name: line.name });
        validatePurchaseLine(line, product);
      }

      const createdAt = nowIso();
      // PO-XXXXXX numbers now use their own counter (nextPurchaseSequence)
      // so purchase and bill sequences advance independently. The v11 DB
      // migration seeds nextPurchaseSequence = nextBillSequence for existing
      // installs, so no PO number already in the DB will repeat.
      const sequence = settings.nextPurchaseSequence ?? settings.nextBillSequence;
      const purchaseId = createId("purchase");
      const purchaseNumber = createPurchaseNumber(sequence);

      const totals = calculateBillTotals(
        input.items.map((item) => ({
          quantity: item.quantity,
          unitBuyPrice: item.unitCost,
          unitSellPrice: item.unitCost,
        })),
        input.form.discountAmount,
        taxAmount,
      );

      const totalAmount = totals.totalAmount;
      if (totalAmount < 0) {
        throw new AppError(AppErrorCode.DISCOUNT_TOO_HIGH);
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
      if (settings.requireShift && split.cashAmount > MONEY_EPSILON && !activeShift) {
        throw new AppError(AppErrorCode.SHIFT_REQUIRED_FOR_CASH_ACTION);
      }
      const resolvedShiftId = activeShift?.id;

      const purchaseItems: PurchaseItem[] = input.items.map((item) => {
        const { isWeight, baseUnit, baseQuantity, pricingQuantity } = resolvePurchaseLine(item);
        return {
          id: createId("purchase_item"),
          purchaseId,
          originalProductId: item.productId,
          barcodeAtPurchase: item.barcode,
          productNameAtPurchase: item.name,
          categoryAtPurchase: item.category,
          itemKind: isMiscLine(item) ? "misc" : "product",
          miscDescription: item.miscDescription,
          // Weight lines store grams + per-kg cost; baseUnit lets the lot and
          // FIFO COGS engine reconcile the two. Unit/misc lines are pieces.
          saleType: isWeight ? "weight" : undefined,
          baseUnit,
          quantityPurchased: baseQuantity,
          unitCostAtPurchase: item.unitCost,
          lineSubtotal: calculateLineSubtotal(pricingQuantity, item.unitCost),
          createdAt,
        };
      });

      const purchase: Purchase = {
        id: purchaseId,
        purchaseNumber,
        createdAt,
        cashierName: input.form.cashierName,
        supplierId: resolvedSupplierId,
        supplierName: input.form.supplierName,
        supplierPhone: input.form.supplierPhone,
        supplierInvoiceNumber: input.form.supplierInvoiceNumber?.trim() || undefined,
        invoiceDate: input.form.invoiceDate?.trim() || undefined,
        paymentDueDate: input.form.paymentDueDate?.trim() || undefined,
        paymentMethod: input.form.paymentMethod,
        subtotal: totals.subtotal,
        discountAmount: input.form.discountAmount,
        taxAmount,
        totalAmount,
        paidAmount: split.paidAmount,
        changeAmount: split.changeAmount,
        cashAmount: split.cashAmount,
        cardAmount: split.cardAmount,
        creditAmount: split.creditAmount,
        // A weight line counts as one item (its "quantity" is kilograms, which
        // would make a line-count meaningless); unit lines count their pieces.
        itemCount: input.items.reduce(
          (sum, item) => sum + (item.saleType === 'weight' ? 1 : item.quantity),
          0,
        ),
        status: "finalized",
        shiftId: resolvedShiftId,
        notes: input.form.notes,
        syncStatus: "pending",
      };

      // INCREASE stock and refresh buyPrice for each purchased product. Under
      // FIFO costing, buyPrice is now only the "last purchase cost / default
      // cost for the next purchase" — it is NOT used to compute profit. Profit
      // comes from the inventory lots created below, so future sales are costed
      // against the actual cost of the units they consume.
      const updatedProducts: Product[] = products.map((product) => {
        const purchasedLines = input.items.filter((i) => i.productId === product.id);
        if (purchasedLines.length === 0) return product;
        // Add stock in base units (grams for weight, pieces otherwise) to match
        // how quantityInStock is stored for that product.
        const totalQty = purchasedLines.reduce(
          (sum, line) => sum + resolvePurchaseLine(line).baseQuantity,
          0,
        );
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

      const stockMovements: StockMovement[] = stockItems.map((item) => ({
        id: createId("move"),
        productId: item.productId,
        movementType: "purchase",
        // Base units (grams for weight) so the movement ledger matches stock.
        quantityChange: resolvePurchaseLine(item).baseQuantity,
        referenceType: "purchase",
        referenceId: purchaseId,
        note: `Purchase ${purchaseNumber}${input.form.supplierName ? ` from ${input.form.supplierName}` : ""}`,
        createdAt,
        syncStatus: "pending",
      }));

      await db.purchases.add(purchase);
      await db.purchaseItems.bulkAdd(purchaseItems);
      await db.products.bulkPut(updatedProducts);
      await db.stockMovements.bulkAdd(stockMovements);

      // One FIFO inventory lot per real product line — the cost basis future
      // sales will consume oldest-first. Misc lines create no lot.
      const createdLots = await createPurchaseLots({ purchase, purchaseItems, createdAt });
      await db.settings.update(settings.id, {
        nextPurchaseSequence: sequence + 1,
        updatedAt: createdAt,
        syncStatus: "pending",
        lastSyncError: undefined,
      });

      const settingsJobId = getSyncQueueId("settings", settings.id);
      const existingSettingsJob = await db.syncQueue.get(settingsJobId);
      const existingSettingsSource =
        (existingSettingsJob?.payload as { source?: string } | undefined)?.source;
      // Treat both sequence-only jobs as non-blocking; a manual settings edit
      // takes precedence over either auto-increment.
      const isExistingSettingsActive =
        existingSettingsJob &&
        existingSettingsJob.status !== "synced" &&
        existingSettingsSource !== "bill-sequence" &&
        existingSettingsSource !== "purchase-sequence";

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
              : { source: "purchase-sequence" },
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
        ...createdLots.map((lot) =>
          buildSyncQueueItem({
            entity: "inventoryLot",
            entityId: lot.id,
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
  void logAudit({
    category: 'purchase',
    action: 'create',
    entityId: result.purchase.id,
    entityLabel: result.purchase.purchaseNumber,
    summary: `${result.purchase.itemCount} items / ${result.purchase.totalAmount}`,
    shiftId: result.purchase.shiftId,
  });
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
  // `quantity` is in base units (grams for weight); unitCostAtPurchase is per
  // kg, so price the return against the kilograms returned.
  const pricingQuantity = pricingQuantityFor(item.saleType, quantity);
  const lineAmount = calculateLineSubtotal(pricingQuantity, item.unitCostAtPurchase);
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
  await assertSubscriptionCanWrite();
  if (!reason) throw new AppError(AppErrorCode.VOID_REASON_REQUIRED);

  // Captured inside the transaction for the post-commit audit log entry.
  let auditPurchaseNumber = '';
  let auditShiftId: string | undefined;

  await db.transaction(
    "rw",
    [db.purchases, db.purchaseItems, db.products, db.stockMovements, db.shifts, db.syncQueue, db.inventoryLots],
    async () => {
      const purchase = await db.purchases.get(input.purchaseId);
      if (!purchase) throw new AppError(AppErrorCode.PURCHASE_NOT_FOUND);
      if (purchase.status === "voided") {
        throw new AppError(AppErrorCode.PURCHASE_ALREADY_VOIDED);
      }
      if (purchase.status !== "finalized") {
        throw new AppError(AppErrorCode.PURCHASE_NOT_FINALIZED);
      }
      await assertShiftStillEditable(purchase.shiftId);
      auditPurchaseNumber = purchase.purchaseNumber;
      auditShiftId = purchase.shiftId;

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

      // Reverse the FIFO lots this purchase created. removePurchaseLotQuantity
      // throws PURCHASE_VOID_INSUFFICIENT_STOCK (and rolls back the whole
      // transaction) if ANY units from a lot were already sold — a void must
      // never claw back stock that has left the shop. This replaces the old
      // cached-stock check with a lot-accurate one.
      const voidedLotIds = new Set<string>();
      for (const item of items) {
        if (isMiscLine(item)) continue;
        const removeQuantity = getRemainingPurchaseItemQuantity(item);
        if (removeQuantity <= 0) continue;
        const updatedLots = await removePurchaseLotQuantity({
          purchaseItemId: item.id,
          quantity: removeQuantity,
          updatedAt: now,
          errorCode: AppErrorCode.PURCHASE_VOID_INSUFFICIENT_STOCK,
        });
        for (const lot of updatedLots) voidedLotIds.add(lot.id);
      }

      const updatedProducts: Product[] = products.map((product) => {
        const removeQuantity = items
          .filter((item) => item.originalProductId === product.id)
          .reduce((sum, item) => sum + getRemainingPurchaseItemQuantity(item), 0);
        if (removeQuantity <= 0) return product;
        return {
          ...product,
          quantityInStock: product.quantityInStock - removeQuantity,
          lastUpdated: now,
          syncStatus: "pending",
          lastSyncError: undefined,
        };
      });

      const stockMovements: StockMovement[] = items.flatMap((item) => {
        const qty = getRemainingPurchaseItemQuantity(item);
        // Misc (متفرقات) purchase lines never added stock, so voiding them
        // removes nothing — only real product lines reverse.
        if (isMiscLine(item) || qty <= 0) return [];
        return [
          {
            id: createId("move"),
            productId: item.originalProductId,
            movementType: "adjustment",
            quantityChange: -qty,
            referenceType: "purchase",
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
        ...Array.from(voidedLotIds).map((lotId) =>
          buildSyncQueueItem({
            entity: "inventoryLot",
            entityId: lotId,
            operation: "update",
          }),
        ),
      ]);
    },
  );
  requestSync();
  void logAudit({
    category: 'purchase',
    action: 'void',
    entityId: input.purchaseId,
    entityLabel: auditPurchaseNumber,
    reason,
    shiftId: auditShiftId,
  });
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
  await assertSubscriptionCanWrite();
  if (!reason) throw new AppError(AppErrorCode.RETURN_REASON_REQUIRED);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new AppError(AppErrorCode.RETURN_QTY_INVALID);
  }

  let auditPurchaseNumber = '';
  let auditProductName = '';
  let auditShiftId: string | undefined;

  await db.transaction(
    "rw",
    [db.purchases, db.purchaseItems, db.products, db.stockMovements, db.shifts, db.syncQueue, db.inventoryLots],
    async () => {
      const [purchase, item] = await Promise.all([
        db.purchases.get(input.purchaseId),
        db.purchaseItems.get(input.itemId),
      ]);
      if (!purchase) throw new AppError(AppErrorCode.PURCHASE_NOT_FOUND);
      if (!item || item.purchaseId !== purchase.id) {
        throw new AppError(AppErrorCode.PURCHASE_ITEM_NOT_FOUND);
      }
      if (purchase.status === "voided") {
        throw new AppError(AppErrorCode.PURCHASE_VOIDED_NO_RETURN);
      }
      await assertShiftStillEditable(purchase.shiftId);

      const remainingQuantity = getRemainingPurchaseItemQuantity(item);
      if (quantity > remainingQuantity) {
        throw new AppError(AppErrorCode.RETURN_EXCEEDS_QTY);
      }

      // Misc (متفرقات) purchase lines have no product — a misc return adjusts
      // the purchase totals but touches no stock.
      const isMiscReturn = isMiscLine(item);
      const product = isMiscReturn
        ? undefined
        : await db.products.get(item.originalProductId);
      if (!isMiscReturn) {
        if (!product) throw new AppError(AppErrorCode.PRODUCT_NOT_FOUND);
        if (product.quantityInStock < quantity) {
          throw new AppError(AppErrorCode.PURCHASE_RETURN_INSUFFICIENT_STOCK);
        }
      }
      auditPurchaseNumber = purchase.purchaseNumber;
      auditProductName = item.productNameAtPurchase;
      auditShiftId = purchase.shiftId;

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

      let stockMovement: StockMovement | null = null;
      const returnedLotIds: string[] = [];
      if (!isMiscReturn && product) {
        // Remove the returned units from this purchase item's FIFO lot(s).
        // Throws PURCHASE_RETURN_INSUFFICIENT_STOCK (rolling back) if those
        // units were already sold — we can only return unsold stock.
        const updatedLots = await removePurchaseLotQuantity({
          purchaseItemId: item.id,
          quantity,
          updatedAt: now,
          errorCode: AppErrorCode.PURCHASE_RETURN_INSUFFICIENT_STOCK,
        });
        for (const lot of updatedLots) returnedLotIds.push(lot.id);

        stockMovement = {
          id: createId("move"),
          productId: item.originalProductId,
          movementType: "adjustment",
          quantityChange: -quantity,
          referenceType: "purchase",
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
      }
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

      const returnSyncJobs = [
        buildSyncQueueItem({
          entity: "purchase",
          entityId: purchase.id,
          operation: "update",
        }),
      ];
      if (stockMovement) {
        returnSyncJobs.push(
          buildSyncQueueItem({
            entity: "stockMovement",
            entityId: stockMovement.id,
            operation: "create",
          }),
        );
      }
      for (const lotId of returnedLotIds) {
        returnSyncJobs.push(
          buildSyncQueueItem({ entity: "inventoryLot", entityId: lotId, operation: "update" }),
        );
      }
      await db.syncQueue.bulkPut(returnSyncJobs);
    },
  );
  requestSync();
  void logAudit({
    category: 'purchase',
    action: 'return',
    entityId: input.purchaseId,
    entityLabel: auditPurchaseNumber,
    reason,
    summary: `${quantity} × ${auditProductName}`,
    shiftId: auditShiftId,
  });
}

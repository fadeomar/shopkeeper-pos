import { AppError, AppErrorCode } from "@/lib/errors/app-error";
import { db } from "@/lib/db/schema";
import { logAudit } from "@/lib/services/audit-service";
import { SETTINGS_ID, customerRepo } from "@/lib/db/repositories";
import {
  calculateBillItemNetContribution,
  calculateBillTotals,
  calculateChange,
  calculateLineProfit,
  calculateLineSubtotal,
} from "@/lib/utils/calculations";
import { nowIso } from "@/lib/utils/date";
import { MONEY_EPSILON, addMoney, roundMoney } from "@/lib/utils/money";
import type { BillSplit } from "@/lib/utils/bill-split";
import { createBillNumber, createId } from "@/lib/utils/id";
import { buildSyncQueueItem, getSyncQueueId } from "@/lib/services/sync-queue-service";
import { assertPaymentMethodEnabled, effectiveTaxAmount } from "@/lib/services/settings-policy";
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
  requestedQuantity: number,
) {
  if (product.status !== "active")
    throw new AppError(AppErrorCode.PRODUCT_INACTIVE, { name: product.name });
  if (!Number.isInteger(line.quantity))
    throw new AppError(AppErrorCode.PRODUCT_QTY_WHOLE, { name: product.name });
  if (line.quantity <= 0)
    throw new AppError(AppErrorCode.PRODUCT_QTY_POSITIVE, { name: product.name });
  if (requestedQuantity > product.quantityInStock)
    throw new AppError(AppErrorCode.PRODUCT_INSUFFICIENT_STOCK, { name: product.name });
  if (!settings.allowLossSale && line.unitSellPrice < line.unitBuyPrice) {
    throw new AppError(AppErrorCode.PRODUCT_LOSS_SALE_BLOCKED, { name: product.name });
  }
}

function getRequestedQuantities(items: BillDraftItem[]): Map<string, number> {
  const requested = new Map<string, number>();
  for (const item of items) {
    requested.set(item.productId, (requested.get(item.productId) ?? 0) + item.quantity);
  }
  return requested;
}

/**
 * Derive the cash/card/credit allocation plus the legacy paid/change figures
 * from a finalized form + total. Invariant for the returned values:
 *   cashAmount + cardAmount + creditAmount === totalAmount
 *
 * Mixed bills require the cashier to provide an explicit split that sums to
 * the total. Cash overpayment with change is supported only for the pure
 * 'cash' method — that's how typical POS interactions work; mixed-with-change
 * is too rare to be worth a separate code path.
 */
function derivePaymentSplit(
  paymentMethod: BillFormValues["paymentMethod"],
  form: BillFormValues,
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
      if (Math.abs(cashAmount + cardAmount - total) > MONEY_EPSILON) {
        throw new AppError(AppErrorCode.BILL_MIXED_SPLIT_MISMATCH);
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

export async function createFinalizedBill(input: {
  items: BillDraftItem[];
  form: BillFormValues;
}): Promise<{ bill: Bill; billItems: BillItem[] }> {
  if (input.items.length === 0) {
    throw new AppError(AppErrorCode.BILL_NO_ITEMS);
  }

  // Normalise tax up front so the pre-transaction payment checks below use the
  // same total the transaction will commit. Without this, a stale offline
  // client that still sends a tax amount under a non-"exclusive" mode could
  // trip a false BILL_PAID_TOO_LOW / BILL_MIXED_SPLIT_MISMATCH on a total that
  // the transaction then discards. The transaction re-reads settings as the
  // authoritative copy.
  const previewSettings = await db.settings.get(SETTINGS_ID);
  const previewTaxAmount = previewSettings
    ? effectiveTaxAmount(previewSettings, input.form.taxAmount)
    : input.form.taxAmount;

  const totalAmountPreview = calculateBillTotals(
    input.items.map((item) => ({
      quantity: item.quantity,
      unitBuyPrice: item.unitBuyPrice,
      unitSellPrice: item.unitSellPrice,
    })),
    input.form.discountAmount,
    previewTaxAmount,
  ).totalAmount;

  if (totalAmountPreview < 0) {
    throw new AppError(AppErrorCode.DISCOUNT_TOO_HIGH);
  }

  const isCreditSalePreview = input.form.paymentMethod === 'credit';
  if (isCreditSalePreview && !input.form.customerName?.trim() && !input.form.customerPhone?.trim()) {
    throw new AppError(AppErrorCode.BILL_CREDIT_NEEDS_CUSTOMER);
  }
  if (input.form.paymentMethod === 'cash' && calculateChange(input.form.paidAmount, totalAmountPreview) < 0) {
    throw new AppError(AppErrorCode.BILL_PAID_TOO_LOW);
  }
  if (input.form.paymentMethod === 'mixed') {
    const cashPreview = Math.max(0, Number(input.form.cashAmount) || 0);
    const cardPreview = Math.max(0, Number(input.form.cardAmount) || 0);
    if (Math.abs(cashPreview + cardPreview - totalAmountPreview) > MONEY_EPSILON) {
      throw new AppError(AppErrorCode.BILL_MIXED_SPLIT_MISMATCH);
    }
  }

  const result = await db.transaction(
    "rw",
    [
      db.bills,
      db.billItems,
      db.products,
      db.stockMovements,
      db.settings,
      db.customers,
      db.shifts,
      db.syncQueue,
    ],
    async () => {
      const settings = await db.settings.get(SETTINGS_ID);
      if (!settings) {
        throw new Error(
          "Settings row not found. Initialize settings before creating bills.",
        );
      }

      // ── Settings-driven business rules (authoritative copy of the UI gates) ──
      // The POS UI already blocks these, but enforce them here too so an
      // offline/stale client (or a future caller) can't bypass store policy.
      assertPaymentMethodEnabled(settings, input.form.paymentMethod);
      if (
        settings.defaultDiscountLimit &&
        settings.defaultDiscountLimit > 0 &&
        input.form.discountAmount > settings.defaultDiscountLimit
      ) {
        throw new AppError(AppErrorCode.DISCOUNT_EXCEEDS_LIMIT, {
          limit: settings.defaultDiscountLimit,
        });
      }
      // Normalise tax to the store's mode — only "exclusive" keeps a manual
      // amount; "none"/"inclusive" force 0 regardless of what the form sent.
      const taxAmount = effectiveTaxAmount(settings, input.form.taxAmount);

      const productIds = input.items.map((item) => item.productId);
      const liveProducts = await db.products.bulkGet(productIds);

      if (liveProducts.some((product) => !product)) {
        throw new AppError(AppErrorCode.PRODUCTS_MISSING);
      }

      const createdAt = nowIso();
      const sequence = settings.nextBillSequence;
      const billId = createId("bill");
      const billNumber = createBillNumber(sequence);
      const products = liveProducts as Product[];

      const requestedQuantities = getRequestedQuantities(input.items);
      for (const line of input.items) {
        const product = products.find(
          (candidate) => candidate.id === line.productId,
        );
        if (!product) throw new AppError(AppErrorCode.LINE_PRODUCT_NOT_FOUND, { name: line.name });
        validateDraftLine(settings, line, product, requestedQuantities.get(line.productId) ?? line.quantity);
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
        taxAmount,
      );

      const totalAmount = totals.totalAmount;
      if (totalAmount < 0) {
        throw new AppError(AppErrorCode.DISCOUNT_TOO_HIGH);
      }
      const isCreditSale = input.form.paymentMethod === 'credit';
      if (isCreditSale && !input.form.customerName?.trim() && !input.form.customerPhone?.trim()) {
        throw new AppError(AppErrorCode.BILL_CREDIT_NEEDS_CUSTOMER);
      }

      const split = derivePaymentSplit(input.form.paymentMethod, input.form, totalAmount);
      // Defensive invariant: the bill type contract requires
      //   cashAmount + cardAmount + creditAmount === totalAmount
      // derivePaymentSplit honors this by construction today, but the check
      // keeps future schema/refactors honest. 0.5¢ tolerance for rounding.
      if (
        Math.abs(
          split.cashAmount + split.cardAmount + split.creditAmount - totalAmount,
        ) > MONEY_EPSILON
      ) {
        throw new AppError(AppErrorCode.BILL_PAYMENT_SPLIT_INVALID);
      }

      // Resolve the customer once per bill. If the cashier supplied a phone
      // that matches an existing Customer, reuse that row; otherwise create
      // a new one and queue its sync. Bills with no customer at all (walk-
      // ins) get undefined customerId — the snapshot fields below still
      // capture name/phone for audit/receipt purposes.
      let resolvedCustomerId: string | undefined;
      const customerResolution = await customerRepo.findOrCreate({
        name: input.form.customerName,
        phone: input.form.customerPhone,
      });
      if (customerResolution) {
        resolvedCustomerId = customerResolution.customer.id;
      }

      // Tag the bill with the active shift if one is open on this device.
      // No shift = no shiftId; reports/drawer reconciliation simply won't
      // count this bill. The shift document doesn't need a re-push here —
      // its open-state fields are immutable and totals are derived from
      // bills at read time.
      const activeShift = await db.shifts.where('status').equals('open').first();
      if (settings.requireShift && !activeShift) {
        throw new AppError(AppErrorCode.BILL_SHIFT_REQUIRED);
      }
      const resolvedShiftId = activeShift?.id;

      const bill: Bill = {
        id: billId,
        billNumber,
        createdAt,
        cashierName: input.form.cashierName,
        customerId: resolvedCustomerId,
        customerName: input.form.customerName,
        customerPhone: input.form.customerPhone,
        shiftId: resolvedShiftId,
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

      // Bill creation only changes settings.nextBillSequence. Tagging the
      // job as 'bill-sequence' routes it through syncBillSequenceToCloud
      // instead of a full settings overwrite, so another device editing
      // storeName/currency offline does not conflict with offline sales.
      // But if a broader manual settings edit is already queued, keep that
      // job's payload so the user's other changes still get pushed.
      const settingsJobId = getSyncQueueId("settings", settings.id);
      const existingSettingsJob = await db.syncQueue.get(settingsJobId);
      const existingSettingsSource =
        (existingSettingsJob?.payload as { source?: string } | undefined)?.source;
      const isExistingSettingsActive =
        existingSettingsJob &&
        existingSettingsJob.status !== "synced" &&
        existingSettingsSource !== "bill-sequence" &&
        existingSettingsSource !== "purchase-sequence";

      const syncJobs = [
        buildSyncQueueItem({
          entity: "bill",
          entityId: bill.id,
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
      // Push the new (or renamed) customer ahead of the bill — sync-provider
      // priority puts customer before bill anyway. `created` covers brand-new
      // rows; `changed` covers the rename-existing-customer case where the
      // local row was updated but would otherwise stay only on this device.
      if (customerResolution?.created || customerResolution?.changed) {
        syncJobs.push(
          buildSyncQueueItem({
            entity: "customer",
            entityId: customerResolution.customer.id,
            operation: customerResolution.created ? "create" : "upsert",
          }),
        );
      }
      await db.syncQueue.bulkPut(syncJobs);

      return { bill, billItems };
    },
  );

  requestSync();
  return result;
}

function appendBillNote(existing: string | undefined, note: string): string {
  return existing ? `${existing}\n${note}` : note;
}

function calculateReturnedLineValue(bill: Bill, item: BillItem, quantity: number) {
  const lineAmount = calculateLineSubtotal(quantity, item.unitSellPriceAtSale);
  const lineProfit = calculateLineProfit(quantity, item.unitBuyPriceAtSale, item.unitSellPriceAtSale);
  const net = calculateBillItemNetContribution(bill, lineAmount, lineProfit);
  return { amount: net.revenue, profit: net.profit };
}

function getRemainingItemQuantity(item: BillItem): number {
  return Math.max(0, item.quantitySold - (item.quantityReturned ?? 0));
}

export async function voidBill(input: {
  billId: string;
  reason: string;
}): Promise<void> {
  const reason = input.reason.trim();
  if (!reason) throw new AppError(AppErrorCode.VOID_REASON_REQUIRED);

  // Captured inside the transaction for the post-commit audit log entry.
  let auditBillNumber = '';
  let auditShiftId: string | undefined;

  await db.transaction(
    "rw",
    [db.bills, db.billItems, db.products, db.stockMovements, db.syncQueue],
    async () => {
      const bill = await db.bills.get(input.billId);
      if (!bill) throw new AppError(AppErrorCode.BILL_NOT_FOUND);
      if (bill.status === "voided") throw new AppError(AppErrorCode.BILL_ALREADY_VOIDED);
      if (bill.status !== "finalized")
        throw new AppError(AppErrorCode.BILL_NOT_FINALIZED);
      auditBillNumber = bill.billNumber;
      auditShiftId = bill.shiftId;

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
  requestSync();
  void logAudit({
    category: 'bill',
    action: 'void',
    entityId: input.billId,
    entityLabel: auditBillNumber,
    reason,
    shiftId: auditShiftId,
  });
}

export async function returnBillItem(input: {
  billId: string;
  itemId: string;
  quantity: number;
  reason: string;
}): Promise<void> {
  const reason = input.reason.trim();
  const quantity = Number(input.quantity);
  if (!reason) throw new AppError(AppErrorCode.RETURN_REASON_REQUIRED);
  if (!Number.isInteger(quantity) || quantity <= 0)
    throw new AppError(AppErrorCode.RETURN_QTY_INVALID);

  let auditBillNumber = '';
  let auditProductName = '';
  let auditShiftId: string | undefined;

  await db.transaction(
    "rw",
    [db.bills, db.billItems, db.products, db.stockMovements, db.syncQueue],
    async () => {
      const [bill, item] = await Promise.all([
        db.bills.get(input.billId),
        db.billItems.get(input.itemId),
      ]);

      if (!bill) throw new AppError(AppErrorCode.BILL_NOT_FOUND);
      if (!item || item.billId !== bill.id)
        throw new AppError(AppErrorCode.BILL_ITEM_NOT_FOUND);
      if (bill.status === "voided")
        throw new AppError(AppErrorCode.BILL_VOIDED_NO_RETURN);

      const remainingQuantity = getRemainingItemQuantity(item);
      if (quantity > remainingQuantity)
        throw new AppError(AppErrorCode.RETURN_EXCEEDS_QTY);

      const product = await db.products.get(item.originalProductId);
      if (!product) throw new AppError(AppErrorCode.PRODUCT_NOT_FOUND);
      auditBillNumber = bill.billNumber;
      auditProductName = item.productNameAtSale;
      auditShiftId = bill.shiftId;

      const now = nowIso();
      const returnedValues = calculateReturnedLineValue(bill, item, quantity);
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

      const calculatedReturnedAmount = addMoney(bill.returnedAmount ?? 0, returnedValues.amount);
      const calculatedReturnedProfit = addMoney(bill.returnedProfit ?? 0, returnedValues.profit);
      const nextReturnedAmount = allReturned ? bill.totalAmount : roundMoney(calculatedReturnedAmount);
      const nextReturnedProfit = allReturned ? bill.totalProfit : roundMoney(calculatedReturnedProfit);

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
  requestSync();
  void logAudit({
    category: 'bill',
    action: 'return',
    entityId: input.billId,
    entityLabel: auditBillNumber,
    reason,
    summary: `${quantity} × ${auditProductName}`,
    shiftId: auditShiftId,
  });
}

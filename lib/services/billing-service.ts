import { AppError, AppErrorCode } from "@/lib/errors/app-error";
import { db } from "@/lib/db/schema";
import { logAudit } from "@/lib/services/audit-service";
import { SETTINGS_ID, customerRepo } from "@/lib/db/repositories";
import {
  calculateBillItemNetContribution,
  calculateBillTotals,
  calculateBillTotalsFromActualCost,
  calculateChange,
  calculateLineProfit,
  calculateLineSubtotal,
} from "@/lib/utils/calculations";
import { nowIso } from "@/lib/utils/date";
import { MONEY_EPSILON, addMoney, roundMoney, subtractMoney } from "@/lib/utils/money";
import { kgToGrams, pricingQuantityFor } from "@/lib/utils/weight";
import type { BillSplit } from "@/lib/utils/bill-split";
import { createBillNumber, createId } from "@/lib/utils/id";
import { buildSyncQueueItem, getSyncQueueId } from "@/lib/services/sync-queue-service";
import { assertPaymentMethodEnabled, effectiveTaxAmount } from "@/lib/services/settings-policy";
import { assertPermission } from "@/lib/services/permission-service";
import { isMiscLine } from "@/lib/utils/misc-items";
import { assertSubscriptionCanWrite } from "@/lib/services/subscription-service";
import {
  allocateFifoLotsForSale,
  restoreAllocationsForReturn,
} from "@/lib/services/inventory-lot-service";
import type {
  Bill,
  BillDraftItem,
  BillFormValues,
  BillItem,
  BillItemCostAllocation,
  Product,
  Settings,
  StockMovement,
} from "@/types/domain";

function requestSync(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('shopkeeper:sync-requested'));
  }
}

/**
 * Resolve a bill draft line into its base quantity (integer grams for weight,
 * pieces otherwise — what stock and lot allocation consume) and its pricing
 * quantity (kilograms for weight, pieces otherwise — the money multiplier).
 */
function resolveBillLine(line: BillDraftItem): {
  isWeight: boolean;
  baseQuantity: number;
  pricingQuantity: number;
} {
  const isWeight = line.saleType === 'weight';
  const baseQuantity = isWeight
    ? Math.round(line.baseQuantity ?? kgToGrams(line.quantity))
    : line.quantity;
  return { isWeight, baseQuantity, pricingQuantity: line.quantity };
}

/** Base units (grams for weight, pieces otherwise) sold on a finalized bill item. */
function billItemBaseSold(item: BillItem): number {
  return item.saleType === 'weight' ? item.baseQuantitySold ?? 0 : item.quantitySold;
}

/** Base units already returned on a bill item. */
function billItemBaseReturned(item: BillItem): number {
  return item.saleType === 'weight'
    ? item.baseQuantityReturned ?? 0
    : item.quantityReturned ?? 0;
}

/** Base units still on a bill item (sold − returned), in grams/pieces. */
function getRemainingBaseQuantity(item: BillItem): number {
  return Math.max(0, billItemBaseSold(item) - billItemBaseReturned(item));
}

function validateDraftLine(
  line: BillDraftItem,
  product: Product,
  requestedQuantity: number,
) {
  if (product.status !== "active")
    throw new AppError(AppErrorCode.PRODUCT_INACTIVE, { name: product.name });
  const { isWeight, baseQuantity } = resolveBillLine(line);
  if (isWeight) {
    // Weight lines sell integer grams (kg input is converted up front). The
    // "whole number" rule applies to grams, not the fractional kg quantity.
    if (!Number.isInteger(baseQuantity))
      throw new AppError(AppErrorCode.PRODUCT_QTY_WHOLE, { name: product.name });
    if (baseQuantity <= 0)
      throw new AppError(AppErrorCode.PRODUCT_QTY_POSITIVE, { name: product.name });
  } else {
    if (!Number.isInteger(line.quantity))
      throw new AppError(AppErrorCode.PRODUCT_QTY_WHOLE, { name: product.name });
    if (line.quantity <= 0)
      throw new AppError(AppErrorCode.PRODUCT_QTY_POSITIVE, { name: product.name });
  }
  // requestedQuantity and quantityInStock are both in the product's base unit
  // (grams for weight, pieces otherwise).
  if (requestedQuantity > product.quantityInStock)
    throw new AppError(AppErrorCode.PRODUCT_INSUFFICIENT_STOCK, { name: product.name });
  // NB: the loss-sale check is NOT here. Under FIFO the authoritative cost is
  // the actual cost of the consumed lots, not product.buyPrice (the latest
  // purchase price). Comparing against buyPrice would wrongly block a sale of
  // cheap old stock, or wrongly allow a sale of expensive old stock. The check
  // runs after lot allocation, against the real weighted cost — see
  // assertLossSaleAllowed below.
}

/**
 * Loss-sale guard, costed against the *actual* FIFO-allocated unit cost.
 *
 * Called after `allocateFifoLotsForSale` so `averageUnitCost` is the weighted
 * cost of the exact lots that left the shelf. Throwing here aborts the
 * enclosing Dexie transaction, so the allocations/lot decrements roll back and
 * nothing is persisted. `settings` is non-null inside createFinalizedBill.
 */
function assertLossSaleAllowed(
  settings: Settings,
  productName: string,
  unitSellPrice: number,
  averageUnitCost: number,
): void {
  if (settings.allowLossSale) return;
  // Money-rounded values; only block when cost meaningfully exceeds price so
  // float noise on an exact break-even sale doesn't trip the guard.
  if (averageUnitCost - unitSellPrice > MONEY_EPSILON) {
    throw new AppError(AppErrorCode.PRODUCT_LOSS_SALE_BLOCKED, { name: productName });
  }
}

/**
 * Validate an ad-hoc متفرقات (misc) line. Misc lines carry no product, so
 * they only need a positive whole quantity and a positive price entered at
 * sale time. Defense-in-depth behind the POS UI's own checks.
 */
function validateMiscDraftLine(line: BillDraftItem) {
  if (!Number.isInteger(line.quantity))
    throw new AppError(AppErrorCode.PRODUCT_QTY_WHOLE, { name: line.name });
  if (line.quantity <= 0)
    throw new AppError(AppErrorCode.PRODUCT_QTY_POSITIVE, { name: line.name });
  if (!Number.isFinite(line.unitSellPrice) || line.unitSellPrice <= 0)
    throw new AppError(AppErrorCode.PAYMENT_AMOUNT_INVALID);
}

function getRequestedQuantities(items: BillDraftItem[]): Map<string, number> {
  const requested = new Map<string, number>();
  for (const item of items) {
    // Misc lines have no real product; skip so they never affect stock checks.
    if (isMiscLine(item)) continue;
    // Sum in base units (grams for weight) so the check compares against
    // quantityInStock, which is stored in the same unit.
    const { baseQuantity } = resolveBillLine(item);
    requested.set(item.productId, (requested.get(item.productId) ?? 0) + baseQuantity);
  }
  return requested;
}

async function assertShiftStillEditable(shiftId?: string): Promise<void> {
  if (!shiftId) return;
  const shift = await db.shifts.get(shiftId);
  if (shift?.status === 'closed') {
    throw new AppError(AppErrorCode.CLOSED_SHIFT_RECORD_LOCKED);
  }
}

/**
 * Derive the cash/card/credit allocation plus the legacy paid/change figures
 * from a finalized form + total. Invariant for the returned values:
 *   cashAmount + cardAmount + creditAmount === totalAmount
 *
 * Mixed payment is retired. Old mixed bills remain readable through
 * normalizeBillSplit(), but new bills cannot be created with paymentMethod
 * 'mixed'. Cash overpayment with change is supported only for pure cash.
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
    case "mixed":
      throw new AppError(AppErrorCode.PAYMENT_METHOD_DISABLED);
  }
}

export async function createFinalizedBill(input: {
  items: BillDraftItem[];
  form: BillFormValues;
}): Promise<{ bill: Bill; billItems: BillItem[] }> {
  await assertSubscriptionCanWrite();
  if (input.items.length === 0) {
    throw new AppError(AppErrorCode.BILL_NO_ITEMS);
  }

  // A discounted sale requires the canDiscount permission (defense-in-depth
  // beyond the UI hiding the discount field). Checked before the transaction
  // since the permission helper reads tables outside this transaction's scope.
  if ((Number(input.form.discountAmount) || 0) > 0) {
    await assertPermission("canDiscount");
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
      // Misc lines have no recorded cost — treat buy = sell so they carry
      // zero margin in the totals (profit is excluded for misc).
      unitBuyPrice: isMiscLine(item) ? item.unitSellPrice : item.unitBuyPrice,
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
    throw new AppError(AppErrorCode.PAYMENT_METHOD_DISABLED);
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
      db.inventoryLots,
      db.billItemCostAllocations,
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

      // Only real product lines hit inventory; misc (متفرقات) lines have no
      // product to look up, track, or decrement.
      const stockItems = input.items.filter((item) => !isMiscLine(item));
      const productIds = Array.from(new Set(stockItems.map((item) => item.productId)));
      const liveProducts = productIds.length > 0 ? await db.products.bulkGet(productIds) : [];

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
        if (isMiscLine(line)) {
          validateMiscDraftLine(line);
          continue;
        }
        const product = products.find(
          (candidate) => candidate.id === line.productId,
        );
        if (!product) throw new AppError(AppErrorCode.LINE_PRODUCT_NOT_FOUND, { name: line.name });
        validateDraftLine(line, product, requestedQuantities.get(line.productId) ?? line.quantity);
      }

      // Build bill items. Real product lines are costed by consuming FIFO
      // inventory lots — `unitBuyPriceAtSale` becomes the weighted-average
      // actual cost of the units that left the shelf, and `lineProfit` is the
      // line revenue minus the exact lot cost (NOT product.buyPrice). Misc
      // lines have no recorded cost: buy = sell so they carry zero profit.
      // Allocations run sequentially so two lines for the same product consume
      // lots in order.
      const billItems: BillItem[] = [];
      const costAllocations: BillItemCostAllocation[] = [];
      const consumedLotIds = new Set<string>();

      for (const item of input.items) {
        const billItemId = createId("bill_item");
        const { isWeight, baseQuantity, pricingQuantity } = resolveBillLine(item);
        // For weight lines, quantitySold/unit prices are in pricing units (kg),
        // so the universal `price × quantity` subtotal holds unchanged.
        const lineSubtotal = calculateLineSubtotal(pricingQuantity, item.unitSellPrice);

        if (isMiscLine(item)) {
          billItems.push({
            id: billItemId,
            billId,
            originalProductId: item.productId,
            barcodeAtSale: item.barcode,
            productNameAtSale: item.name,
            categoryAtSale: item.category,
            itemKind: "misc",
            miscDescription: item.miscDescription,
            quantitySold: item.quantity,
            unitBuyPriceAtSale: item.unitSellPrice,
            unitSellPriceAtSale: item.unitSellPrice,
            lineSubtotal,
            lineProfit: 0,
            createdAt,
          });
          continue;
        }

        const { allocations, totalCost, averageUnitCost } = await allocateFifoLotsForSale({
          billId,
          billItemId,
          productId: item.productId,
          // Allocate in base units (grams for weight); the lot engine returns
          // averageUnitCost per pricing unit (per kg) to match the sell price.
          quantity: baseQuantity,
          createdAt,
        });
        // Loss-sale policy is enforced against the real FIFO cost, not the
        // product's latest buyPrice. Throwing here rolls back the allocation.
        assertLossSaleAllowed(settings, item.name, item.unitSellPrice, averageUnitCost);
        costAllocations.push(...allocations);
        for (const allocation of allocations) consumedLotIds.add(allocation.inventoryLotId);

        billItems.push({
          id: billItemId,
          billId,
          originalProductId: item.productId,
          barcodeAtSale: item.barcode,
          productNameAtSale: item.name,
          categoryAtSale: item.category,
          itemKind: "product",
          miscDescription: item.miscDescription,
          // saleType + base grams are stored so old bills render exact weights
          // and returns can restore the precise grams to their lots.
          saleType: isWeight ? "weight" : undefined,
          quantitySold: pricingQuantity,
          baseQuantitySold: isWeight ? baseQuantity : undefined,
          unitBuyPriceAtSale: averageUnitCost,
          unitSellPriceAtSale: item.unitSellPrice,
          lineSubtotal,
          lineProfit: subtractMoney(lineSubtotal, totalCost),
          createdAt,
        });
      }

      // Totals from the actual per-line profits computed above. Amount math is
      // cost-independent, so totalAmount matches the pre-transaction preview;
      // only totalProfit now reflects real cost of goods sold.
      const totals = calculateBillTotalsFromActualCost(
        billItems.map((billItem) => ({
          quantity: billItem.quantitySold,
          unitSellPrice: billItem.unitSellPriceAtSale,
          lineProfit: billItem.lineProfit,
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
        // Weight lines count as one item each (their "quantity" is kilograms);
        // unit/misc lines count their pieces.
        itemCount: input.items.reduce(
          (sum, item) => sum + (item.saleType === 'weight' ? 1 : item.quantity),
          0,
        ),
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
          (sum, line) => sum + resolveBillLine(line).baseQuantity,
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

      const stockMovements: StockMovement[] = stockItems.map((item) => ({
        id: createId("move"),
        productId: item.productId,
        movementType: "sale",
        // Base units (grams for weight) so the ledger matches the stock change.
        quantityChange: -resolveBillLine(item).baseQuantity,
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
      // job as 'bill-sequence' routes it through syncSettingsSequencesToCloud
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
        // FIFO records: the consumed lots (now decremented) and the new cost
        // allocations that prove which lots each line drew from.
        ...Array.from(consumedLotIds).map((lotId) =>
          buildSyncQueueItem({
            entity: "inventoryLot",
            entityId: lotId,
            operation: "update",
          }),
        ),
        ...costAllocations.map((allocation) =>
          buildSyncQueueItem({
            entity: "billItemCostAllocation",
            entityId: allocation.id,
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
  void logAudit({
    category: 'bill',
    action: 'create',
    entityId: result.bill.id,
    entityLabel: result.bill.billNumber,
    summary: `${result.bill.itemCount} items / ${result.bill.totalAmount}`,
    shiftId: result.bill.shiftId,
  });
  return result;
}

function appendBillNote(existing: string | undefined, note: string): string {
  return existing ? `${existing}\n${note}` : note;
}

function calculateReturnedLineValue(bill: Bill, item: BillItem, baseQuantity: number) {
  // baseQuantity is in base units (grams for weight); convert to the pricing
  // quantity (kg) before applying per-kg prices. Misc/unit lines pass through.
  const pricingQuantity = pricingQuantityFor(item.saleType, baseQuantity);
  const lineAmount = calculateLineSubtotal(pricingQuantity, item.unitSellPriceAtSale);
  const lineProfit = calculateLineProfit(pricingQuantity, item.unitBuyPriceAtSale, item.unitSellPriceAtSale);
  const net = calculateBillItemNetContribution(bill, lineAmount, lineProfit);
  return { amount: net.revenue, profit: net.profit };
}

export async function voidBill(input: {
  billId: string;
  reason: string;
}): Promise<void> {
  const reason = input.reason.trim();
  await assertSubscriptionCanWrite();
  if (!reason) throw new AppError(AppErrorCode.VOID_REASON_REQUIRED);
  await assertPermission("canVoid");

  // Captured inside the transaction for the post-commit audit log entry.
  let auditBillNumber = '';
  let auditShiftId: string | undefined;

  await db.transaction(
    "rw",
    [db.bills, db.billItems, db.products, db.stockMovements, db.shifts, db.syncQueue, db.inventoryLots, db.billItemCostAllocations],
    async () => {
      const bill = await db.bills.get(input.billId);
      if (!bill) throw new AppError(AppErrorCode.BILL_NOT_FOUND);
      if (bill.status === "voided") throw new AppError(AppErrorCode.BILL_ALREADY_VOIDED);
      if (bill.status !== "finalized")
        throw new AppError(AppErrorCode.BILL_NOT_FINALIZED);
      await assertShiftStillEditable(bill.shiftId);
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

      // Restore the remaining (non-returned) units of every real product line
      // back to the exact lots they were drawn from. Old bills predate FIFO and
      // have no allocations — those just restore the cached product stock below.
      const restoredLotIds = new Set<string>();
      const restoredAllocationIds = new Set<string>();
      for (const item of items) {
        if (isMiscLine(item)) continue;
        // Restore in base units (grams for weight) — that's how allocations and
        // stock are counted.
        const remainingQty = getRemainingBaseQuantity(item);
        if (remainingQty <= 0) continue;
        const itemAllocations = await db.billItemCostAllocations
          .where("billItemId")
          .equals(item.id)
          .toArray();
        if (itemAllocations.length === 0) continue;
        const restore = await restoreAllocationsForReturn({
          billId: bill.id,
          billItemId: item.id,
          quantity: remainingQty,
          updatedAt: now,
        });
        for (const lot of restore.updatedLots) restoredLotIds.add(lot.id);
        for (const allocation of restore.updatedAllocations) restoredAllocationIds.add(allocation.id);
      }

      const updatedProducts: Product[] = products.map((product) => {
        const restoreQuantity = items
          .filter((item) => item.originalProductId === product.id)
          .reduce((sum, item) => sum + getRemainingBaseQuantity(item), 0);

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
        const quantityToRestore = getRemainingBaseQuantity(item);
        // Misc (متفرقات) lines never touched stock, so voiding them restores
        // nothing — only real product lines produce a reversal movement.
        if (isMiscLine(item) || quantityToRestore <= 0) return [];
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
        // Weight lines also fully return their grams so base-unit math balances.
        baseQuantityReturned: item.saleType === 'weight' ? item.baseQuantitySold : item.baseQuantityReturned,
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
        ...Array.from(restoredLotIds).map((lotId) =>
          buildSyncQueueItem({
            entity: "inventoryLot",
            entityId: lotId,
            operation: "update",
          }),
        ),
        ...Array.from(restoredAllocationIds).map((allocationId) =>
          buildSyncQueueItem({
            entity: "billItemCostAllocation",
            entityId: allocationId,
            operation: "update",
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
  await assertSubscriptionCanWrite();
  if (!reason) throw new AppError(AppErrorCode.RETURN_REASON_REQUIRED);
  if (!Number.isInteger(quantity) || quantity <= 0)
    throw new AppError(AppErrorCode.RETURN_QTY_INVALID);
  await assertPermission("canReturn");

  let auditBillNumber = '';
  let auditProductName = '';
  let auditShiftId: string | undefined;

  await db.transaction(
    "rw",
    [db.bills, db.billItems, db.products, db.stockMovements, db.shifts, db.syncQueue, db.inventoryLots, db.billItemCostAllocations],
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
      await assertShiftStillEditable(bill.shiftId);

      // `quantity` is in base units (grams for weight, pieces otherwise).
      const remainingQuantity = getRemainingBaseQuantity(item);
      if (quantity > remainingQuantity)
        throw new AppError(AppErrorCode.RETURN_EXCEEDS_QTY);

      // Misc (متفرقات) lines have no product behind them — a misc return
      // adjusts the bill's financial totals but never restores stock.
      const isMiscReturn = isMiscLine(item);
      const product = isMiscReturn
        ? undefined
        : await db.products.get(item.originalProductId);
      if (!isMiscReturn && !product) throw new AppError(AppErrorCode.PRODUCT_NOT_FOUND);
      auditBillNumber = bill.billNumber;
      auditProductName = item.productNameAtSale;
      auditShiftId = bill.shiftId;

      const now = nowIso();

      // Cost the return from the EXACT lots consumed by this line, when the
      // bill carries FIFO allocations. A partial return across lots of
      // different cost is otherwise impossible to value with a single line
      // average. Old (pre-FIFO) bills have no allocations — fall back to the
      // bill item's snapshot buy price.
      let returnedValues: { amount: number; profit: number };
      const restoredLotIds: string[] = [];
      const restoredAllocationIds: string[] = [];
      if (isMiscReturn) {
        returnedValues = calculateReturnedLineValue(bill, item, quantity);
      } else {
        const itemAllocations = await db.billItemCostAllocations
          .where("billItemId")
          .equals(item.id)
          .toArray();
        if (itemAllocations.length === 0) {
          returnedValues = calculateReturnedLineValue(bill, item, quantity);
        } else {
          const restore = await restoreAllocationsForReturn({
            billId: bill.id,
            billItemId: item.id,
            quantity,
            updatedAt: now,
          });
          // Revenue uses the pricing quantity (kg for weight); the returned
          // cost from `restore` is already a per-kg-derived money total.
          const lineAmount = calculateLineSubtotal(
            pricingQuantityFor(item.saleType, quantity),
            item.unitSellPriceAtSale,
          );
          // Gross returned profit = returned revenue (before bill discount)
          // minus the exact cost of the returned units. The bill-level
          // discount/tax is then allocated proportionally below.
          const grossLineProfit = subtractMoney(lineAmount, restore.returnedCost);
          const net = calculateBillItemNetContribution(bill, lineAmount, grossLineProfit);
          returnedValues = { amount: net.revenue, profit: net.profit };
          for (const lot of restore.updatedLots) restoredLotIds.push(lot.id);
          for (const allocation of restore.updatedAllocations) restoredAllocationIds.push(allocation.id);
        }
      }

      // Track returned quantity in BOTH views: quantityReturned in pricing
      // units (kg for weight) for money/display, baseQuantityReturned in grams
      // for weight so base-unit remaining math stays exact.
      const isWeightItem = item.saleType === 'weight';
      const nextReturnedQuantity =
        (item.quantityReturned ?? 0) + pricingQuantityFor(item.saleType, quantity);
      const nextBaseReturned = isWeightItem
        ? (item.baseQuantityReturned ?? 0) + quantity
        : undefined;
      await db.billItems.update(item.id, {
        quantityReturned: nextReturnedQuantity,
        ...(isWeightItem ? { baseQuantityReturned: nextBaseReturned } : {}),
      });

      const allItems = await db.billItems
        .where("billId")
        .equals(bill.id)
        .toArray();
      const nextItems = allItems.map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, quantityReturned: nextReturnedQuantity, baseQuantityReturned: nextBaseReturned }
          : candidate,
      );
      const allReturned = nextItems.every(
        (candidate) => getRemainingBaseQuantity(candidate) <= 0,
      );

      const calculatedReturnedAmount = addMoney(bill.returnedAmount ?? 0, returnedValues.amount);
      const calculatedReturnedProfit = addMoney(bill.returnedProfit ?? 0, returnedValues.profit);
      const nextReturnedAmount = allReturned ? bill.totalAmount : roundMoney(calculatedReturnedAmount);
      const nextReturnedProfit = allReturned ? bill.totalProfit : roundMoney(calculatedReturnedProfit);

      let stockMovement: StockMovement | null = null;
      if (!isMiscReturn && product) {
        stockMovement = {
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
      }
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

      const returnSyncJobs = [
        buildSyncQueueItem({
          entity: "bill",
          entityId: bill.id,
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
      for (const lotId of restoredLotIds) {
        returnSyncJobs.push(
          buildSyncQueueItem({ entity: "inventoryLot", entityId: lotId, operation: "update" }),
        );
      }
      for (const allocationId of restoredAllocationIds) {
        returnSyncJobs.push(
          buildSyncQueueItem({ entity: "billItemCostAllocation", entityId: allocationId, operation: "update" }),
        );
      }
      await db.syncQueue.bulkPut(returnSyncJobs);
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

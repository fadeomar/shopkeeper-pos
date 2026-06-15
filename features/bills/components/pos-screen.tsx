"use client";

import Link from "next/link";
import clsx from "clsx";
import { getServiceErrorMessage } from "@/lib/errors/get-error-message";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { customerRepo, settingsRepo } from "@/lib/db/repositories";
import { normalizePhone } from "@/lib/utils/customer-key";
import { getActiveShift } from "@/lib/services/shift-service";
import { billFormSchema, type BillFormSchema } from "@/features/bills/schema";
import {
  creditAwareDefaultPaidAmount,
  resolveActualPaidAmount,
  wasPaidAmountManuallyEdited,
} from "@/features/bills/utils/paid-amount";
import {
  calculateBillTotals,
  calculateChange,
  calculateLineSubtotal,
} from "@/lib/utils/calculations";
import { formatCurrency } from "@/lib/utils/money";
import { createFinalizedBill } from "@/lib/services/billing-service";
import { nowIso } from "@/lib/utils/date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CircleCheck,
  Cloud,
  CloudUpload,
  Phone,
  ReceiptText,
  Search,
  ShoppingCart,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { NumberField } from "@/components/ui/number-field";
import { MoneyInput, MoneyInputRHF } from "@/components/ui/money-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DataTable, useDataTableLabels } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { BarcodeScannerModal } from "@/components/barcode/barcode-scanner-modal";
import { useLocale } from "@/components/providers/locale-context";
import { Card } from "@/components/ui/card";
import { FitText } from "@/components/ui/fit-text";
import { blurInputOnEnter } from "@/lib/utils/dismiss-on-enter";
import { PaymentMethodControl } from "@/components/pos/payment-method-control";
import { QuantityStepper } from "@/components/pos/quantity-stepper";
import { QuickProductModal } from "./quick-product-modal";
import { WeightEditorModal } from "./weight-editor-modal";
import { ReceiptView } from "./receipt-view";
import {
  formatStockDisplay,
  formatWeightForCart,
  gramsToKg,
} from "@/lib/utils/weight";
import {
  getDefaultProductUnit,
  getSellableUnits,
  isMultiUnitProduct,
} from "@/lib/utils/multi-unit";
import { normalizeBarcode } from "@/lib/utils/barcode";
import { createId } from "@/lib/utils/id";
import { isMiscLine, MISC_ITEM_BARCODE } from "@/lib/utils/misc-items";
import { useAuth } from "@/components/providers/auth-context";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useOnlineStatus } from "@/lib/hooks/use-online-status";
import type {
  Bill,
  BillDraftItem,
  BillItem,
  Customer,
  Product,
  ProductUnit,
  Settings,
} from "@/types/domain";

/**
 * Cart identity. Multi-unit lines are keyed by productId + saleUnitId so the
 * same product can sit in the cart as both "1 box" and "2 strips". Misc and
 * unit/weight lines have no saleUnitId, so the key is just productId — the
 * original behavior is unchanged.
 */
function lineKey(item: BillDraftItem): string {
  return item.saleUnitId ? `${item.productId}::${item.saleUnitId}` : item.productId;
}

/** Build a multi-unit cart line for `quantity` of `unit`. */
function buildMultiUnitLine(
  product: Product,
  unit: ProductUnit,
  quantity: number,
): BillDraftItem {
  const conversion = unit.conversionToBase || 1;
  return {
    productId: product.id,
    barcode: unit.barcode || product.barcode,
    name: product.name,
    category: product.category,
    saleType: "multi_unit",
    saleUnitId: unit.id,
    saleUnitName: unit.name,
    conversionToBase: conversion,
    availableStock: product.quantityInStock, // base (piece) units
    baseQuantity: quantity * conversion,
    quantity,
    // Informational only — finalize re-costs from FIFO lots. Per sold unit.
    unitBuyPrice: unit.buyPrice ?? product.buyPrice * conversion,
    unitSellPrice: unit.sellPrice,
  };
}

/**
 * Choose the unit to add: the default sale unit when at least one of it fits in
 * stock, otherwise the largest sellable unit that fits (so the last few base
 * units are still sellable). Always returns a unit.
 */
function pickAddUnit(
  product: Product,
  units: ProductUnit[] | undefined,
  baseStock: number,
): ProductUnit {
  const def = getDefaultProductUnit(product, units);
  if ((def.conversionToBase || 1) <= baseStock) return def;
  const fitting = getSellableUnits(product, units)
    .filter((u) => (u.conversionToBase || 1) <= baseStock)
    .sort((a, b) => b.conversionToBase - a.conversionToBase);
  return fitting[0] ?? def;
}

/**
 * Compute 3 context-aware cash tender amounts above the given total.
 * Steps through common denominations (10 → 50 → 100 → 200 → 500 → 1000)
 * and collects the first unique rounded-up value at each step.
 * Example: total=43 → [50, 100, 200]; total=87 → [90, 100, 200]
 */
function smartCashChips(total: number): number[] {
  const steps = [10, 50, 100, 200, 500, 1000];
  const chips: number[] = [];
  for (const step of steps) {
    const rounded = Math.ceil(total / step) * step;
    if (rounded > total && !chips.includes(rounded)) {
      chips.push(rounded);
      if (chips.length === 3) break;
    }
  }
  return chips;
}

const SUCCESS_AUTO_DISMISS_MS = 8000;

// Draft key is scoped per signed-in user so two cashiers sharing a browser
// don't see each other's in-progress carts. Pre-uid drafts under the old
// flat "shopkeeper-pos-bill-draft-v1" key are intentionally orphaned (no
// data is lost — Dexie still has every saved bill — only the in-progress
// scratch state is dropped on the migration).
const POS_DRAFT_KEY_PREFIX = "shopkeeper-pos-bill-draft-v1";

/** Compact native dropdown to switch a multi-unit cart line's sale unit. */
function UnitChipSelect({
  value,
  units,
  onChange,
  label,
}: {
  value: string;
  units: ProductUnit[];
  onChange: (unitId: string) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-border-default bg-surface px-2 py-1 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand/30"
    >
      {units.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
        {label}
      </span>
      {children}
    </label>
  );
}

function SummaryRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 last:border-0">
      <span
        className={`text-sm ${highlight ? "font-semibold text-slate-900" : "text-slate-500"}`}
      >
        {label}
      </span>
      <span
        className={`text-sm tabular-nums ${highlight ? "font-bold text-slate-900" : "font-medium text-slate-700"}`}
        dir="ltr"
      >
        {value}
      </span>
    </div>
  );
}

function SuccessPanel({
  bill,
  items,
  settings,
  currency,
  onDismiss,
}: {
  bill: Bill;
  items: BillItem[];
  settings?: Settings;
  currency: string;
  onDismiss: () => void;
}) {
  const { t } = useLocale();
  const online = useOnlineStatus();
  const newSaleRef = useRef<HTMLButtonElement | null>(null);
  const amountDue = Math.max(0, bill.totalAmount - bill.paidAmount);

  // Track the bill's sync status live so the badge updates when the
  // background sync worker picks it up.
  const liveBill = useLiveQuery(
    () => db.bills.get(bill.id),
    [bill.id],
  );
  const syncStatus = liveBill?.syncStatus ?? bill.syncStatus ?? 'pending';
  const isSynced = syncStatus === 'synced';

  useEffect(() => {
    newSaleRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <Card className="flex flex-col gap-5" padding="md">
      {/* Success header — generous breathing room so this reads as a
          confirmation moment, not just another card. */}
      <div className="flex items-center gap-3">
        <CircleCheck
          aria-hidden
          size={40}
          strokeWidth={2}
          className="shrink-0 text-success"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-success">
            {t("billing.saleCompleted")}
          </p>
          <p className="font-mono text-base font-bold text-fg">
            {bill.billNumber}
          </p>
        </div>
        {/* Sync state badge — updates live as the background sync worker runs */}
        <span
          className={clsx(
            "shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            isSynced
              ? "bg-success-soft text-success"
              : "bg-warning-soft text-warning",
          )}
        >
          {isSynced ? (
            <Cloud size={11} aria-hidden />
          ) : (
            <CloudUpload size={11} aria-hidden />
          )}
          {isSynced ? t("billing.syncedToCloud") : t("billing.savedLocally")}
        </span>
      </div>

      <div className="rounded-xl border border-success/20 bg-success-soft px-4 py-3">
        <SummaryRow
          label={t("billing.total")}
          value={formatCurrency(bill.totalAmount, currency)}
          highlight
        />
        {bill.changeAmount > 0.001 && (
          <SummaryRow
            label={t("billing.changeDueBack")}
            value={formatCurrency(bill.changeAmount, currency)}
          />
        )}
        {amountDue > 0 && (
          <SummaryRow
            label={t("billing.amountDue")}
            value={formatCurrency(amountDue, currency)}
            highlight
          />
        )}
      </div>

      <ReceiptView bill={bill} items={items} settings={settings} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* The bill-detail route is dynamic (/bills/[id]); when offline it may
            not be in the SW cache, so the link would dead-end. The full receipt
            is already shown above, so offline we disable the link and explain
            rather than letting the cashier tap into a broken navigation. */}
        {online ? (
          <Link
            href={`/bills/${bill.id}`}
            // Visually a "secondary action" — uses the same outline-button
            // styling as the Button component, with a leading receipt icon
            // to anchor "view the bill we just made".
            className={clsx(
              "inline-flex items-center justify-center gap-2 rounded-xl border font-semibold transition-colors",
              "border-border-default bg-surface text-fg-secondary hover:bg-surface-soft hover:border-border-strong",
              "px-4 py-2.5 text-sm min-h-11",
              "focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brand)_22%,transparent)]",
            )}
          >
            <ReceiptText size={16} aria-hidden />
            {t("billing.openBillDetail")}
          </Link>
        ) : (
          <span
            aria-disabled
            title={t("billing.billDetailOfflineHint")}
            className={clsx(
              "inline-flex flex-col items-center justify-center gap-0.5 rounded-xl border",
              "border-border-default bg-surface-soft px-4 py-2 text-sm min-h-11",
              "cursor-not-allowed text-fg-muted",
            )}
          >
            <span className="inline-flex items-center gap-2 font-semibold">
              <ReceiptText size={16} aria-hidden />
              {t("billing.openBillDetail")}
            </span>
            <span className="text-[11px] font-medium">
              {t("billing.billDetailOfflineHint")}
            </span>
          </span>
        )}
        <Button
          ref={newSaleRef}
          type="button"
          size="lg"
          onClick={onDismiss}
          className="w-full"
        >
          {t("billing.newSale")}
        </Button>
      </div>
    </Card>
  );
}

export function PosScreen() {
  const { t, dir } = useLocale();
  const tableLabels = useDataTableLabels();
  const { user } = useAuth();
  const { canDiscount } = usePermissions();
  const products = useLiveQuery(
    () => db.products.where("status").equals("active").sortBy("name"),
    [],
  );
  // Units for multi-unit products. Loaded once and grouped by productId so the
  // cart can resolve a product's sellable units without a per-line query.
  const productUnits = useLiveQuery(() => db.productUnits.toArray(), []);
  const unitsByProduct = useMemo(() => {
    const map = new Map<string, ProductUnit[]>();
    for (const unit of productUnits ?? []) {
      const list = map.get(unit.productId) ?? [];
      list.push(unit);
      map.set(unit.productId, list);
    }
    return map;
  }, [productUnits]);
  const customers = useLiveQuery(() => customerRepo.list(), []);
  const activeShift = useLiveQuery(() => getActiveShift(), []);
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const { push } = useToast();
  const online = useOnlineStatus();
  const currency = settings?.currency ?? "ILS";
  const draftKey = user?.uid ? `${POS_DRAFT_KEY_PREFIX}:${user.uid}` : null;

  // Mobile UX: tapping a numeric input opens the soft keyboard and leaves it
  // up until the user taps far away. That keyboard covers the bill summary +
  // finalize button on small screens. Hitting Enter (or "Done" on Android,
  // shown via enterKeyHint below) blurs the field, which collapses the
  // keyboard and exposes the rest of the page again.
  function dismissKeyboardOnEnter(
    event: React.KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  const [draftItems, setDraftItems] = useState<BillDraftItem[]>([]);
  // Open weight picker for a weight product being added or edited in the cart.
  const [weightEditor, setWeightEditor] = useState<{
    product: Product;
    itemId?: string;
    initialGrams?: number;
  } | null>(null);
  const staleDraftChecked = useRef(false);
  const [barcodeQuery, setBarcodeQuery] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [miscOpen, setMiscOpen] = useState(false);
  const [miscDescription, setMiscDescription] = useState("");
  const [miscPrice, setMiscPrice] = useState("");
  const [miscQuantity, setMiscQuantity] = useState("1");
  const [customerSheetOpen, setCustomerSheetOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [manualCustomerName, setManualCustomerName] = useState("");
  const [manualCustomerPhone, setManualCustomerPhone] = useState("");
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [missingBarcode, setMissingBarcode] = useState("");
  const [isPaidAmountManuallyEdited, setIsPaidAmountManuallyEdited] =
    useState(false);
  const [lastFinalized, setLastFinalized] = useState<{
    bill: Bill;
    items: BillItem[];
  } | null>(null);
  const productOptions = useMemo(
    () =>
      (products ?? []).map((product) => ({
        value: product.id,
        label: product.name,
        description: [product.barcode, product.brand, product.category]
          .filter(Boolean)
          .join(" • "),
        meta: (
          <span className="text-xs text-slate-500">
            {formatCurrency(product.sellPrice, currency)} ·{" "}
            {product.quantityInStock} {t("billing.stock").toLowerCase()}
          </span>
        ),
      })),
    [products, currency, t],
  );

  const [helpOpen, setHelpOpen] = useState(false);

  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const lastAppliedCashierNameRef = useRef(t("common.owner"));

  const form = useForm<BillFormSchema>({
    resolver: zodResolver(billFormSchema),
    defaultValues: {
      cashierName: settings?.cashierName ?? t("common.owner"),
      customerName: "",
      customerPhone: "",
      paymentMethod: "cash",
      discountAmount: 0,
      taxAmount: 0,
      paidAmount: 0,
      cashAmount: 0,
      cardAmount: 0,
      notes: "",
    },
  });

  useEffect(() => {
    if (!scannerOpen) barcodeInputRef.current?.focus();
  }, [scannerOpen]);

  useEffect(() => {
    if (!settings) return;
    const nextDefault = settings.cashierName || t("common.owner");
    const current = form.getValues("cashierName");
    if (!current || current === lastAppliedCashierNameRef.current) {
      form.setValue("cashierName", nextDefault, { shouldDirty: false });
    }
    lastAppliedCashierNameRef.current = nextDefault;
  }, [settings, form]);

  // Restore draft from localStorage — only when we know the user. Skipping
  // when uid is unknown prevents loading another account's stale draft on
  // a different login.
  useEffect(() => {
    if (!draftKey) return;
    const raw = window.localStorage.getItem(draftKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        items: BillDraftItem[];
        form: BillFormSchema;
      };
      const items = parsed.items ?? [];
      setDraftItems(items);
      form.reset(parsed.form);
      const autoTotal = calculateBillTotals(
        items.map((i) => ({
          quantity: i.quantity,
          unitBuyPrice: i.unitBuyPrice,
          unitSellPrice: i.unitSellPrice,
        })),
        parsed.form.discountAmount,
        parsed.form.taxAmount,
      ).totalAmount;
      setIsPaidAmountManuallyEdited(
        wasPaidAmountManuallyEdited(
          parsed.form.paidAmount,
          parsed.form.paymentMethod,
          autoTotal,
        ),
      );
    } catch {
      window.localStorage.removeItem(draftKey);
    }
  }, [draftKey, form]);

  // Once — after products load, reconcile draft prices/stock against live data.
  // Runs only on the first render where both products and a non-empty cart are
  // available. The ref gate prevents it from re-running on every cart change.
  useEffect(() => {
    if (staleDraftChecked.current || !products || draftItems.length === 0)
      return;
    staleDraftChecked.current = true;

    let priceCount = 0;
    let removedCount = 0;
    let stockCount = 0;

    const next = draftItems.reduce<BillDraftItem[]>((acc, item) => {
      const live = products.find((p) => p.id === item.productId);
      if (!live || live.status !== "active") {
        removedCount += 1;
        return acc; // drop the item
      }
      // Out-of-stock: drop the item entirely. Keeping it at qty=1 with stock=0
      // would show a "1 / 0 in stock" line that the user can't act on and the
      // service rejects on submit. Better to surface it now and let them rescan
      // when the product is restocked.
      if (live.quantityInStock <= 0) {
        removedCount += 1;
        return acc;
      }
      const priceChanged =
        live.sellPrice !== item.unitSellPrice ||
        live.buyPrice !== item.unitBuyPrice;
      if (priceChanged) priceCount += 1;

      if (item.saleType === "weight") {
        // Weight lines track grams; cap against live stock (grams) and keep the
        // kg quantity in sync. No min-1 clamp — a 0.75 kg line stays 0.75 kg.
        const base = item.baseQuantity ?? 0;
        const cappedBase = Math.min(base, live.quantityInStock);
        if (cappedBase < base) stockCount += 1;
        acc.push({
          ...item,
          unitSellPrice: live.sellPrice,
          unitBuyPrice: live.buyPrice,
          availableStock: live.quantityInStock,
          baseQuantity: cappedBase,
          quantity: gramsToKg(cappedBase),
        });
        return acc;
      }

      if (item.saleType === "multi_unit") {
        // Multi-unit lines track a sold-unit count; cap by how many whole units
        // fit in live base stock and refresh availableStock. Unit prices are
        // snapshots on the line and left as-is.
        const conversion = item.conversionToBase || 1;
        const maxUnits = Math.floor(live.quantityInStock / conversion);
        if (maxUnits < 1) {
          // The product can no longer supply even one of this unit — drop it.
          removedCount += 1;
          return acc;
        }
        const cappedQty = Math.min(item.quantity, maxUnits);
        if (cappedQty < item.quantity) stockCount += 1;
        acc.push({
          ...item,
          availableStock: live.quantityInStock,
          quantity: Math.max(1, cappedQty),
          baseQuantity: Math.max(1, cappedQty) * conversion,
        });
        return acc;
      }

      const cappedQty = Math.min(item.quantity, live.quantityInStock);
      if (cappedQty < item.quantity) stockCount += 1;

      acc.push({
        ...item,
        unitSellPrice: live.sellPrice,
        unitBuyPrice: live.buyPrice,
        availableStock: live.quantityInStock,
        quantity: Math.max(1, cappedQty),
      });
      return acc;
    }, []);

    const changed =
      next.length !== draftItems.length || priceCount > 0 || stockCount > 0;
    if (!changed) return;

    setDraftItems(next);
    if (removedCount > 0)
      push(
        t("billing.draftProductsRemoved", { count: String(removedCount) }),
        "error",
      );
    if (priceCount > 0)
      push(t("billing.draftPricesRefreshed", { count: String(priceCount) }));
    if (stockCount > 0)
      push(
        t("billing.draftStockAdjusted", { count: String(stockCount) }),
        "error",
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, draftItems]);

  // Watch all form fields for draft persistence
  const watchedCashierName = form.watch("cashierName");
  const watchedCustomerName = form.watch("customerName");
  const watchedCustomerPhone = form.watch("customerPhone");
  const watchedPaymentMethod = form.watch("paymentMethod");
  const watchedDiscountAmount = Number(form.watch("discountAmount") || 0);
  const watchedTaxAmount = Number(form.watch("taxAmount") || 0);
  const watchedPaidAmount = Number(form.watch("paidAmount") || 0);
  const watchedNotes = form.watch("notes");

  useEffect(() => {
    if (!customerSheetOpen) return;
    const searchValue = customerSearch.trim();
    const searchLooksLikePhone = Boolean(normalizePhone(searchValue));
    setManualCustomerName(watchedCustomerName?.trim() || (searchLooksLikePhone ? "" : searchValue));
    setManualCustomerPhone(watchedCustomerPhone?.trim() || (searchLooksLikePhone ? searchValue : ""));
    // Only seed the manual form when the sheet opens; after that, the fields are user-controlled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerSheetOpen]);

  async function saveManualCustomer() {
    const name = manualCustomerName.trim();
    const phone = manualCustomerPhone.trim();
    if (!name && !phone) {
      push(t("billing.customerRequired"), "error");
      return;
    }

    setIsSavingCustomer(true);
    try {
      const normalizedPhone = normalizePhone(phone);
      const existing = normalizedPhone
        ? await customerRepo.findByNormalizedPhone(normalizedPhone)
        : undefined;
      const now = nowIso();
      const customer: Customer = {
        id: existing?.id ?? createId("cust"),
        name: name || existing?.name || t("billing.customerName"),
        phone: phone || undefined,
        normalizedPhone: normalizedPhone || undefined,
        notes: existing?.notes,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        syncStatus: "pending",
      };

      await customerRepo.save(customer);
      selectCustomer(customer);
      setCustomerSheetOpen(false);
      setCustomerSearch("");
      setManualCustomerName("");
      setManualCustomerPhone("");
      push({
        title: existing ? t("billing.customerUpdated") : t("billing.customerSaved"),
        description: t("billing.customerSelected"),
        tone: "success",
      });
    } catch (error) {
      push(getServiceErrorMessage(error, t, t("billing.customerSaveFailed")), "error");
    } finally {
      setIsSavingCustomer(false);
    }
  }

  useEffect(() => {
    if (!draftKey) return;
    const payload = JSON.stringify({
      items: draftItems,
      form: {
        cashierName: watchedCashierName ?? "",
        customerName: watchedCustomerName ?? "",
        customerPhone: watchedCustomerPhone ?? "",
        paymentMethod: watchedPaymentMethod ?? "cash",
        discountAmount: watchedDiscountAmount,
        taxAmount: watchedTaxAmount,
        paidAmount: watchedPaidAmount,
        notes: watchedNotes ?? "",
      },
    });
    window.localStorage.setItem(draftKey, payload);
  }, [
    draftKey,
    draftItems,
    watchedCashierName,
    watchedCustomerName,
    watchedCustomerPhone,
    watchedPaymentMethod,
    watchedDiscountAmount,
    watchedTaxAmount,
    watchedPaidAmount,
    watchedNotes,
  ]);

  const billSummary = useMemo(
    () =>
      calculateBillTotals(
        draftItems.map((i) => ({
          quantity: i.quantity,
          unitBuyPrice: i.unitBuyPrice,
          unitSellPrice: i.unitSellPrice,
        })),
        watchedDiscountAmount,
        watchedTaxAmount,
      ),
    [draftItems, watchedDiscountAmount, watchedTaxAmount],
  );

  const isCreditSale = watchedPaymentMethod === "credit";
  const defaultPaidAmount = creditAwareDefaultPaidAmount(
    watchedPaymentMethod,
    billSummary.totalAmount,
  );
  const actualPaidAmount = resolveActualPaidAmount(
    isPaidAmountManuallyEdited,
    watchedPaidAmount,
    defaultPaidAmount,
  );
  const actualChangeAmount = useMemo(
    () => calculateChange(actualPaidAmount, billSummary.totalAmount),
    [actualPaidAmount, billSummary.totalAmount],
  );
  const amountDue = Math.max(
    0,
    calculateChange(billSummary.totalAmount, actualPaidAmount),
  );
  const hasCreditCustomer = Boolean(
    watchedCustomerName?.trim() || watchedCustomerPhone?.trim(),
  );

  // ── Settings-driven enforcement ───────────────────────────────────────────
  // Payment-method toggles (undefined = enabled). Mixed payment is retired and
  // intentionally not offered as a new-sale option.
  const enableCash = settings?.enableCash !== false;
  const enableCard = settings?.enableCard !== false;
  const enableCredit = settings?.enableCredit !== false;
  const availablePaymentMethods = useMemo<BillFormSchema["paymentMethod"][]>(() => {
    const methods: BillFormSchema["paymentMethod"][] = [];
    if (enableCash) methods.push("cash");
    if (enableCard) methods.push("card");
    if (enableCredit) methods.push("credit");
    // Never leave the cashier with zero ways to take payment.
    return methods.length ? methods : ["cash"];
  }, [enableCash, enableCard, enableCredit]);

  // If the selected method was just disabled in settings, snap to the first
  // allowed one so the form never holds a now-invalid method.
  useEffect(() => {
    if (
      !availablePaymentMethods.includes(
        watchedPaymentMethod as BillFormSchema["paymentMethod"],
      )
    ) {
      form.setValue("paymentMethod", availablePaymentMethods[0], {
        shouldDirty: false,
      });
    }
  }, [availablePaymentMethods, watchedPaymentMethod, form]);

  // requireShift turns the soft "no shift open" banner into a hard block.
  // activeShift is `undefined` while loading and `null` when none is open —
  // only block on an explicit null so we don't flicker during load.
  const requireShift = settings?.requireShift === true;
  const shiftBlocked = requireShift && activeShift === null;

  // Cap the discount at the store's configured limit (0 = no limit).
  const discountLimit = settings?.defaultDiscountLimit ?? 0;
  const discountExceedsLimit =
    discountLimit > 0 && watchedDiscountAmount > discountLimit;

  // Only "exclusive" tax mode shows a manual tax field that is added on top.
  // "none" and "inclusive" hide it and force the amount to 0 — there is no
  // tax-rate engine yet, so an "inclusive" manual amount would be double
  // counted by `total = subtotal - discount + tax`.
  const taxEnabled = settings?.taxMode === "exclusive";
  useEffect(() => {
    if (!taxEnabled && watchedTaxAmount !== 0) {
      form.setValue("taxAmount", 0, {
        shouldDirty: false,
        shouldValidate: true,
      });
    }
  }, [taxEnabled, watchedTaxAmount, form]);

  // (Customer typeahead removed — replaced by CustomerSelectSheet modal)

  function selectCustomer(customer: Customer) {
    form.setValue("customerName", customer.name, { shouldDirty: true });
    form.setValue("customerPhone", customer.phone ?? "", { shouldDirty: true });
  }
  const hasValidTotal = billSummary.totalAmount >= 0;
  const hasEnoughPayment = isCreditSale || actualChangeAmount >= 0;
  const canFinalize =
    draftItems.length > 0 &&
    hasValidTotal &&
    hasEnoughPayment &&
    !shiftBlocked &&
    !discountExceedsLimit &&
    (!isCreditSale || hasCreditCustomer);

  useEffect(() => {
    if (isPaidAmountManuallyEdited) return;
    form.setValue("paidAmount", defaultPaidAmount, {
      shouldDirty: false,
      shouldValidate: true,
    });
  }, [defaultPaidAmount, isPaidAmountManuallyEdited, form]);


  // Auto-dismiss the success panel after a short window so the right column
  // returns to the bill summary form. Cancelled if the cashier starts a new
  // sale (appendProduct) or explicitly dismisses via the panel's buttons.
  useEffect(() => {
    if (!lastFinalized) return;
    const id = window.setTimeout(
      () => setLastFinalized(null),
      SUCCESS_AUTO_DISMISS_MS,
    );
    return () => window.clearTimeout(id);
  }, [lastFinalized]);

  // Global Ctrl/Cmd+Enter opens the finalize confirm modal so the cashier
  // can finish a sale without leaving the keyboard. Skipped when any modal
  // is already open (Esc handles those) and when nothing is finalizable.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (confirmOpen || scannerOpen || quickAddOpen || miscOpen || lastFinalized)
        return;
      if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
      if (!canFinalize) return;
      e.preventDefault();
      form.handleSubmit(() => setConfirmOpen(true))();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    confirmOpen,
    scannerOpen,
    quickAddOpen,
    miscOpen,
    lastFinalized,
    canFinalize,
    form,
  ]);

  // ── FIXED double-toast: push() is called OUTSIDE setDraftItems updater ──
  // `focusBarcode` controls whether the barcode input is refocused after the
  // add. Barcode scan / manual barcode entry / quick-add want this (keeps the
  // scan loop fast). Picking from the product dropdown does NOT — on mobile it
  // would pop the keyboard open and interrupt checkout (QA blocker).
  function appendProduct(
    product: Product,
    options?: { focusBarcode?: boolean; forcedUnitId?: string },
  ) {
    if (product.quantityInStock <= 0) {
      push(t("billing.outOfStock"), "error");
      return;
    }

    // Adding the first item of the next sale means the cashier has moved on
    // from the just-completed bill — collapse the success panel immediately.
    if (lastFinalized) setLastFinalized(null);

    // Weight products don't add a piece — open the weight picker instead. The
    // product itself drives the UI; there is no global "weight mode".
    if (product.saleType === "weight") {
      const existingLine = draftItems.find((i) => i.productId === product.id);
      setWeightEditor({
        product,
        itemId: existingLine?.productId,
        initialGrams: existingLine?.baseQuantity,
      });
      return;
    }

    // Multi-unit products add their default sale unit (or the exact unit a
    // scanned unit-barcode resolved to). The cart line is keyed by the unit so
    // the same product can appear in several units at once.
    if (isMultiUnitProduct(product)) {
      const units = unitsByProduct.get(product.id);
      const baseStock = product.quantityInStock;
      const forced = options?.forcedUnitId
        ? getSellableUnits(product, units).find((u) => u.id === options.forcedUnitId)
        : undefined;
      const unit = forced ?? pickAddUnit(product, units, baseStock);
      const conversion = unit.conversionToBase || 1;
      const unitMax = Math.floor(baseStock / conversion);
      const labelName = `${product.name} (${unit.name})`;
      if (unitMax < 1) {
        push(t("billing.outOfStock"), "error");
        return;
      }
      const key = `${product.id}::${unit.id}`;
      const existingUnitLine = draftItems.find((i) => lineKey(i) === key);
      if (existingUnitLine) {
        const nextQty = Math.min(existingUnitLine.quantity + 1, unitMax);
        setDraftItems((cur) =>
          cur.map((i) =>
            lineKey(i) === key
              ? { ...i, quantity: nextQty, baseQuantity: nextQty * conversion }
              : i,
          ),
        );
        push(t("billing.itemUpdated", { name: labelName, qty: nextQty }));
      } else {
        setDraftItems((cur) => [...cur, buildMultiUnitLine(product, unit, 1)]);
        push(t("billing.itemAdded", { name: labelName }));
      }
      if (options?.focusBarcode !== false) {
        setTimeout(() => barcodeInputRef.current?.focus(), 0);
      }
      return;
    }

    const existing = draftItems.find((i) => i.productId === product.id);

    if (existing) {
      const nextQty = Math.min(existing.quantity + 1, product.quantityInStock);
      setDraftItems((cur) =>
        cur.map((i) =>
          i.productId === product.id ? { ...i, quantity: nextQty } : i,
        ),
      );
      push(t("billing.itemUpdated", { name: product.name, qty: nextQty }));
    } else {
      const newItem: BillDraftItem = {
        productId: product.id,
        barcode: product.barcode,
        name: product.name,
        category: product.category,
        availableStock: product.quantityInStock,
        quantity: 1,
        unitBuyPrice: product.buyPrice,
        unitSellPrice: product.sellPrice,
      };
      setDraftItems((cur) => [...cur, newItem]);
      push(t("billing.itemAdded", { name: product.name }));
    }

    if (options?.focusBarcode !== false) {
      setTimeout(() => barcodeInputRef.current?.focus(), 0);
    }
  }

  // Commit a weight (grams) from the weight picker into the cart. One line per
  // weight product; confirming sets that line's weight exactly (so reopening
  // the picker edits rather than stacks).
  function commitWeight(grams: number) {
    const editor = weightEditor;
    if (!editor) return;
    const { product } = editor;
    if (lastFinalized) setLastFinalized(null);
    setDraftItems((cur) => {
      const exists = cur.some((i) => i.productId === product.id);
      const line: BillDraftItem = {
        productId: product.id,
        barcode: product.barcode,
        name: product.name,
        category: product.category,
        saleType: "weight",
        availableStock: product.quantityInStock, // grams
        quantity: gramsToKg(grams), // kg, drives money math
        baseQuantity: grams, // integer grams, drives inventory
        unitBuyPrice: product.buyPrice, // per kg
        unitSellPrice: product.sellPrice, // per kg
      };
      return exists
        ? cur.map((i) => (i.productId === product.id ? line : i))
        : [...cur, line];
    });
    push(t("billing.itemAdded", { name: product.name }));
    setWeightEditor(null);
    setTimeout(() => barcodeInputRef.current?.focus(), 0);
  }

  // Reopen the weight picker for an existing weighted cart line, prefilled.
  function openWeightEditor(item: BillDraftItem) {
    const product = products?.find((p) => p.id === item.productId);
    if (!product) return;
    setWeightEditor({ product, itemId: item.productId, initialGrams: item.baseQuantity });
  }

  // Switch a multi-unit cart line to a different sale unit (e.g. strip → box).
  // Keeps the displayed quantity where stock allows; if a line for the target
  // unit already exists, the two merge.
  function changeLineUnit(item: BillDraftItem, newUnitId: string) {
    const product = products?.find((p) => p.id === item.productId);
    if (!product) return;
    const units = unitsByProduct.get(product.id);
    const newUnit = getSellableUnits(product, units).find((u) => u.id === newUnitId);
    if (!newUnit || newUnit.id === item.saleUnitId) return;
    const conversion = newUnit.conversionToBase || 1;
    const unitMax = Math.floor(product.quantityInStock / conversion);
    if (unitMax < 1) {
      push(t("billing.outOfStock"), "error");
      return;
    }
    const oldKey = lineKey(item);
    const newKey = `${product.id}::${newUnit.id}`;
    const desiredQty = Math.min(Math.max(1, item.quantity), unitMax);
    setDraftItems((cur) => {
      const target = cur.find((i) => lineKey(i) === newKey && lineKey(i) !== oldKey);
      if (target) {
        const mergedQty = Math.min(target.quantity + desiredQty, unitMax);
        return cur
          .filter((i) => lineKey(i) !== oldKey)
          .map((i) =>
            lineKey(i) === newKey
              ? { ...i, quantity: mergedQty, baseQuantity: mergedQty * conversion }
              : i,
          );
      }
      return cur.map((i) =>
        lineKey(i) === oldKey ? buildMultiUnitLine(product, newUnit, desiredQty) : i,
      );
    });
  }

  function promptQuickAddProduct(barcode: string) {
    setScannerOpen(false);
    setBarcodeQuery("");
    setMissingBarcode(barcode);
    setQuickAddOpen(true);
    push(t("billing.productNotFoundAddNow", { barcode }), "error");
  }

  // Resolve a scanned/typed barcode to a product, and — for multi-unit
  // products — the specific unit when a ProductUnit barcode matched. A
  // product's own barcode takes precedence over a unit barcode.
  function resolveBarcode(
    bc: string,
  ): { product: Product; unitId?: string } | undefined {
    const productMatch = products?.find((p) => normalizeBarcode(p.barcode) === bc);
    if (productMatch) return { product: productMatch };
    const unitMatch = (productUnits ?? []).find(
      (u) => u.barcode && normalizeBarcode(u.barcode) === bc,
    );
    if (unitMatch) {
      const product = products?.find((p) => p.id === unitMatch.productId);
      if (product) return { product, unitId: unitMatch.id };
    }
    return undefined;
  }

  function addByBarcode() {
    const bc = normalizeBarcode(barcodeQuery);
    if (!bc) return;
    const hit = resolveBarcode(bc);
    if (!hit) {
      promptQuickAddProduct(bc);
      return;
    }
    appendProduct(hit.product, hit.unitId ? { forcedUnitId: hit.unitId } : undefined);
    setBarcodeQuery("");
  }

  function handleScanForBill(barcode: string) {
    const bc = normalizeBarcode(barcode);
    const hit = resolveBarcode(bc);
    if (!hit) {
      promptQuickAddProduct(bc);
      return;
    }
    appendProduct(hit.product, { focusBarcode: false, forcedUnitId: hit.unitId });
  }

  function handleQuickProductCreated(product: Product) {
    setQuickAddOpen(false);
    setBarcodeQuery("");
    setMissingBarcode("");
    if (product.quantityInStock > 0) {
      appendProduct(product);
    } else {
      push(t("billing.productCreatedNotAdded", { name: product.name }));
    }
  }

  function resetMiscForm() {
    setMiscDescription("");
    setMiscPrice("");
    setMiscQuantity("1");
  }

  function addMiscLine(priceOverride?: number) {
    const price = Math.max(0, Number(priceOverride ?? miscPrice) || 0);
    const quantity = Math.max(1, Math.trunc(Number(miscQuantity) || 1));
    const description = miscDescription.trim();

    if (price <= 0) {
      push(t("billing.miscPriceRequired"), "error");
      return;
    }

    if (lastFinalized) setLastFinalized(null);

    const name = description
      ? `${t("billing.miscItem")} - ${description}`
      : t("billing.miscItem");
    const newItem: BillDraftItem = {
      productId: createId("misc"),
      itemKind: "misc",
      miscDescription: description || undefined,
      barcode: MISC_ITEM_BARCODE,
      name,
      category: t("billing.miscCategory"),
      availableStock: Number.MAX_SAFE_INTEGER,
      quantity,
      // Cost is intentionally equal to sell price so product-profit reports do
      // not invent profit for a sale whose real cost was not recorded.
      unitBuyPrice: price,
      unitSellPrice: price,
    };

    setDraftItems((cur) => [...cur, newItem]);
    push(
      t("billing.miscItemAdded", {
        total: formatCurrency(calculateLineSubtotal(quantity, price), currency),
      }),
    );
    setMiscOpen(false);
    resetMiscForm();
    setTimeout(() => barcodeInputRef.current?.focus(), 0);
  }

  function updateQuantity(key: string, quantity: number) {
    // Number(""), Number("abc"), Number(".") all yield NaN/non-integer values.
    // Coerce to a safe whole number before clamping so the draft never enters
    // a state where totals/profit/tax derived from quantity become NaN.
    const safeQuantity = Number.isFinite(quantity) ? Math.trunc(quantity) : 1;
    setDraftItems((cur) =>
      cur.map((i) => {
        if (lineKey(i) !== key) return i;
        // Multi-unit: cap by how many whole units fit in base stock and keep
        // the base quantity (used for stock/FIFO) in sync.
        if (i.saleType === "multi_unit") {
          const conversion = i.conversionToBase || 1;
          const maxUnits = Math.max(1, Math.floor(i.availableStock / conversion));
          const q = Math.max(1, Math.min(safeQuantity, maxUnits));
          return { ...i, quantity: q, baseQuantity: q * conversion };
        }
        // Misc lines have no real stock cap (sentinel availableStock), so they
        // are never clamped down to a stock count.
        const maxQuantity = isMiscLine(i)
          ? Number.MAX_SAFE_INTEGER
          : i.availableStock;
        return {
          ...i,
          quantity: Math.max(1, Math.min(safeQuantity, maxQuantity)),
        };
      }),
    );
  }

  function updateMiscSellPrice(productId: string, price: number) {
    const safePrice = Number.isFinite(price) ? Math.max(0, price) : 0;
    setDraftItems((cur) =>
      cur.map((i) =>
        i.productId === productId && isMiscLine(i)
          ? { ...i, unitBuyPrice: safePrice, unitSellPrice: safePrice }
          : i,
      ),
    );
  }

  function clearDraft() {
    setDraftItems([]);
    setIsPaidAmountManuallyEdited(false);
    form.reset({
      cashierName: settings?.cashierName ?? t("common.owner"),
      customerName: "",
      customerPhone: "",
      paymentMethod: "cash",
      discountAmount: 0,
      taxAmount: 0,
      paidAmount: 0,
      cashAmount: 0,
      cardAmount: 0,
      notes: "",
    });
    if (draftKey) window.localStorage.removeItem(draftKey);
    barcodeInputRef.current?.focus();
  }

  async function finalize(values: BillFormSchema) {
    if (draftItems.length === 0) {
      push(t("billing.addOneProduct"), "error");
      return;
    }
    try {
      const { bill, billItems } = await createFinalizedBill({
        items: draftItems,
        form: {
          ...values,
          paidAmount: actualPaidAmount,
        },
      });
      clearDraft();
      setConfirmOpen(false);
      setLastFinalized({ bill, items: billItems });
      // Structured success toast that reinforces offline-first trust: it tells
      // the cashier the sale is saved and whether it's syncing now or queued
      // until reconnect. The SuccessPanel owns the actions (open bill / new
      // sale), so the toast intentionally carries no action button.
      push({
        title: t("billing.saleCompletedNumber", { number: bill.billNumber }),
        description: online
          ? t("billing.saleSavedSyncing")
          : t("billing.saleSavedOffline"),
        tone: "success",
      });
    } catch (error) {
      push(getServiceErrorMessage(error, t, t("billing.billFailed")), "error");
    }
  }

  const draftItemColumns: ColumnDef<BillDraftItem, unknown>[] = [
    {
      accessorKey: "name",
      header: t("billing.product"),
      cell: ({ row }) => {
        const item = row.original;
        const units =
          item.saleType === "multi_unit"
            ? getSellableUnits(
                products?.find((p) => p.id === item.productId) ?? ({} as Product),
                unitsByProduct.get(item.productId),
              )
            : [];
        return (
          <div className="flex flex-col gap-1">
            <span className="font-medium text-slate-800">{item.name}</span>
            {item.saleType === "multi_unit" && units.length > 0 && (
              <UnitChipSelect
                value={item.saleUnitId ?? ""}
                units={units}
                onChange={(unitId) => changeLineUnit(item, unitId)}
                label={t("multiUnit.changeUnit")}
              />
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "availableStock",
      header: t("billing.stock"),
      cell: ({ row }) => {
        const item = row.original;
        if (isMiscLine(item)) {
          return <span className="tabular-nums text-slate-500">{t("billing.nonStock")}</span>;
        }
        if (item.saleType === "multi_unit") {
          const conversion = item.conversionToBase || 1;
          return (
            <span className="tabular-nums text-slate-500">
              {Math.floor(item.availableStock / conversion)} {item.saleUnitName}
            </span>
          );
        }
        return (
          <span className="tabular-nums text-slate-500">
            {formatStockDisplay(item.saleType, item.availableStock)}
          </span>
        );
      },
    },
    {
      accessorKey: "quantity",
      header: t("billing.qty"),
      cell: ({ row }) => {
        const item = row.original;
        // Weight lines show the chosen weight with an edit affordance instead
        // of a 1-step counter (you don't increment tomatoes by the piece).
        if (item.saleType === "weight") {
          return (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="tabular-nums"
              onClick={() => openWeightEditor(item)}
            >
              {formatWeightForCart(item.baseQuantity ?? 0)}
            </Button>
          );
        }
        const maxUnits =
          item.saleType === "multi_unit"
            ? Math.max(1, Math.floor(item.availableStock / (item.conversionToBase || 1)))
            : isMiscLine(item)
              ? undefined
              : item.availableStock;
        return (
          <QuantityStepper
            value={item.quantity}
            onChange={(v) => updateQuantity(lineKey(item), v)}
            min={1}
            max={maxUnits}
            className="w-[160px]"
          />
        );
      },
    },
    {
      accessorKey: "unitSellPrice",
      header: t("billing.sell"),
      cell: ({ row }) =>
        isMiscLine(row.original) ? (
          <MoneyInput
            value={row.original.unitSellPrice}
            onValueChange={(v) =>
              updateMiscSellPrice(row.original.productId, v)
            }
            currency={currency}
            min={0}
            onKeyDown={dismissKeyboardOnEnter}
            inputSize="sm"
            className="w-32"
            fullWidth={false}
          />
        ) : (
          <span className="tabular-nums text-slate-700" dir="ltr">
            {formatCurrency(row.original.unitSellPrice, currency)}
            {row.original.saleType === "weight"
              ? ` ${t("weight.perKgSuffix")}`
              : row.original.saleType === "multi_unit"
                ? ` / ${row.original.saleUnitName}`
                : ""}
          </span>
        ),
    },
    {
      id: "subtotal",
      header: t("billing.subtotalCol"),
      accessorFn: (row) =>
        calculateLineSubtotal(row.quantity, row.unitSellPrice),
      cell: ({ row }) => (
        <span className="font-medium tabular-nums text-slate-800" dir="ltr">
          {formatCurrency(
            calculateLineSubtotal(
              row.original.quantity,
              row.original.unitSellPrice,
            ),
            currency,
          )}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            setDraftItems((cur) =>
              cur.filter((i) => lineKey(i) !== lineKey(row.original)),
            )
          }
        >
          {t("common.remove")}
        </Button>
      ),
    },
  ];

  const canSaveManualCustomer = Boolean(
    manualCustomerName.trim() || manualCustomerPhone.trim(),
  );

  if (!products) {
    return (
      <Card>
        <p className="text-sm text-slate-500">{t("billing.loadingPos")}</p>
      </Card>
    );
  }

  return (
    <>
      {/* If no shift is open the bill still finalizes, but it won't be counted
          in any drawer reconciliation. Surface a soft warning + a link to the
          shift workspace so the cashier sees the consequence before selling. */}
      {activeShift === null && (
        <Link
          // The new /shift route page exists but Next's typedRoutes type
          // generation runs at build time; cast matches the pattern used
          // by sidebar-nav.tsx for dynamic hrefs.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          href={"/shift" as any}
          className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning hover:bg-warning-soft/80 transition-colors"
        >
          <span className="font-medium">{t("billing.noShiftOpenWarning")}</span>
          <span className="text-xs font-semibold uppercase tracking-wide">
            {t("billing.openShift")} {dir === "rtl" ? "←" : "→"}
          </span>
        </Link>
      )}

      {/* Mobile-first layout, desktop keeps two columns */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-4 xl:gap-5 items-start pb-28 lg:pb-0">
        <div className="flex flex-col gap-4">
          {/* ── Build bill panel ─────────────────────────────────────────── */}
          <Card className="flex flex-col gap-4" padding="sm">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-800">
              {t("billing.buildBill")}
            </h3>
            {draftItems.length > 0 && (
              <span className="rounded-full bg-info-soft px-3 py-1 text-xs font-semibold text-info">
                {draftItems.length} {t("billing.items")}
              </span>
            )}
          </div>

          {/* Barcode input row */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2">
            <Input
              ref={barcodeInputRef}
              placeholder={t("billing.typeBarcode")}
              value={barcodeQuery}
              inputMode={scannerOpen ? "none" : undefined}
              readOnly={scannerOpen}
              onChange={(e) => setBarcodeQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addByBarcode();
                } else if (e.key === "Escape" && barcodeQuery) {
                  e.preventDefault();
                  setBarcodeQuery("");
                }
              }}
              className="flex-1"
            />
            <Button type="button" variant="secondary" onClick={addByBarcode}>
              {t("common.add")}
            </Button>
            <Button
              type="button"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                barcodeInputRef.current?.blur();
                setScannerOpen(true);
              }}
            >
              {t("common.scan")}
            </Button>
            <div className="relative">
              <button
                type="button"
                aria-label={t("billing.shortcutsHelp")}
                aria-expanded={helpOpen}
                onClick={() => setHelpOpen((open) => !open)}
                className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
              >
                ?
              </button>
              {helpOpen && (
                <>
                  {/* Backdrop captures outside clicks to dismiss the popover. */}
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setHelpOpen(false)}
                    aria-hidden
                  />
                  <div
                    role="dialog"
                    aria-label={t("billing.shortcutsHelp")}
                    className="absolute end-0 top-full mt-2 z-20 min-w-[260px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
                  >
                    <p className="text-sm font-semibold text-slate-800 mb-1.5">
                      {t("billing.shortcutsHelp")}
                    </p>
                    <ul className="space-y-1 text-xs text-slate-600">
                      <li>{t("billing.shortcutFinalize")}</li>
                      <li>{t("billing.shortcutClearBarcode")}</li>
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Product select row — picking a product adds it to the bill
              immediately (no separate "Add item" tap). The selection resets to
              the placeholder so the same product can be picked again. The misc
              button lets the cashier add an ad-hoc open-price line. */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
            <SearchableSelect
              value=""
              onValueChange={(value) => {
                if (!value) return;
                const product = products?.find((p) => p.id === value);
                // Dropdown selection must not refocus the barcode input — on
                // mobile that re-opens the keyboard and interrupts checkout.
                if (product) appendProduct(product, { focusBarcode: false });
              }}
              options={productOptions}
              placeholder={t("billing.selectProduct")}
              searchPlaceholder={t("products.searchPlaceholder")}
              emptyMessage={t("common.noResults")}
              disabled={!products?.length}
            />
            <Button
              type="button"
              variant="soft"
              onClick={() => setMiscOpen(true)}
            >
              {t("billing.addMiscItem")}
            </Button>
          </div>

          {/* Items */}
          {draftItems.length === 0 ? (
            <EmptyState
              title={t("billing.noItems")}
              description={t("billing.noItemsDesc")}
            />
          ) : (
            <>
              <div className="grid gap-2 md:hidden">
                {draftItems.map((item) => (
                  <div
                    key={lineKey(item)}
                    className="touch-card rounded-2xl border border-border-default bg-surface p-3 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate">
                          {item.name}
                        </p>
                        <p className="text-xs text-slate-500 font-mono truncate">
                          {isMiscLine(item)
                            ? item.miscDescription || t("billing.miscQuickSale")
                            : item.barcode}
                        </p>
                        {item.saleType === "multi_unit" && (
                          <div className="mt-1.5">
                            <UnitChipSelect
                              value={item.saleUnitId ?? ""}
                              units={getSellableUnits(
                                products?.find((p) => p.id === item.productId) ??
                                  ({} as Product),
                                unitsByProduct.get(item.productId),
                              )}
                              onChange={(unitId) => changeLineUnit(item, unitId)}
                              label={t("multiUnit.changeUnit")}
                            />
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDraftItems((cur) =>
                            cur.filter((i) => lineKey(i) !== lineKey(item)),
                          )
                        }
                      >
                        {t("common.remove")}
                      </Button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-xl bg-slate-50 p-2">
                        <p className="text-slate-500">{t("billing.stock")}</p>
                        <p className="font-bold text-slate-800 tabular-nums">
                          {isMiscLine(item)
                            ? t("billing.nonStock")
                            : item.saleType === "multi_unit"
                              ? `${Math.floor(item.availableStock / (item.conversionToBase || 1))} ${item.saleUnitName}`
                              : formatStockDisplay(item.saleType, item.availableStock)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-2">
                        <p className="text-slate-500">{t("billing.sell")}</p>
                        {isMiscLine(item) ? (
                          <MoneyInput
                            value={item.unitSellPrice}
                            onValueChange={(v) =>
                              updateMiscSellPrice(item.productId, v)
                            }
                            currency={currency}
                            min={0}
                            onKeyDown={dismissKeyboardOnEnter}
                            inputSize="sm"
                            className="mt-1"
                            fullWidth
                          />
                        ) : (
                          <p
                            className="font-bold text-slate-800 tabular-nums"
                            dir="ltr"
                          >
                            {formatCurrency(item.unitSellPrice, currency)}
                            {item.saleType === "weight"
                              ? ` ${t("weight.perKgSuffix")}`
                              : item.saleType === "multi_unit"
                                ? ` / ${item.saleUnitName}`
                                : ""}
                          </p>
                        )}
                      </div>
                      <div className="rounded-xl bg-slate-50 p-2">
                        <p className="text-slate-500">
                          {t("billing.subtotalCol")}
                        </p>
                        <p
                          className="font-bold text-slate-800 tabular-nums"
                          dir="ltr"
                        >
                          {formatCurrency(
                            calculateLineSubtotal(
                              item.quantity,
                              item.unitSellPrice,
                            ),
                            currency,
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-slate-600">
                        {item.saleType === "weight" ? t("weight.label") : t("billing.qty")}
                      </span>
                      {item.saleType === "weight" ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="tabular-nums"
                          onClick={() => openWeightEditor(item)}
                        >
                          {formatWeightForCart(item.baseQuantity ?? 0)} · {t("weight.editWeight")}
                        </Button>
                      ) : (
                        <NumberField
                          value={item.quantity}
                          onValueChange={(v) => updateQuantity(lineKey(item), v)}
                          precision="integer"
                          min={1}
                          max={
                            item.saleType === "multi_unit"
                              ? Math.max(1, Math.floor(item.availableStock / (item.conversionToBase || 1)))
                              : isMiscLine(item)
                                ? undefined
                                : item.availableStock
                          }
                          showStepper
                          align="center"
                          onKeyDown={dismissKeyboardOnEnter}
                          className="w-[170px]"
                          fullWidth={false}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block">
                <DataTable
                  columns={draftItemColumns}
                  data={draftItems}
                  enableGlobalSearch={false}
                  emptyTitle={t("billing.addOneProduct")}
                  pageSize={10}
                  labels={tableLabels}
                  getRowId={(row) => lineKey(row)}
                />
              </div>
            </>
          )}
          </Card>

          {lastFinalized && (
            <SuccessPanel
              bill={lastFinalized.bill}
              items={lastFinalized.items}
              settings={settings}
              currency={currency}
              onDismiss={() => {
                setLastFinalized(null);
                setTimeout(() => barcodeInputRef.current?.focus(), 0);
              }}
            />
          )}
        </div>

        {/* ── Bill summary panel ───────────────────────────────────────── */}
        <div className="xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto xl:pe-1">
          <Card className="flex flex-col gap-4" padding="sm">
              <h3 className="text-base font-semibold text-slate-800">
                {t("billing.billSummary")}
              </h3>

              <form
                className="flex flex-col gap-3"
                onSubmit={form.handleSubmit(() => setConfirmOpen(true))}
              >
                <FormField label={t("billing.cashierName")}>
                  <Input {...form.register("cashierName")} />
                </FormField>
                {/* Customer — compact selector on mobile, sheet opens on tap */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                    {t("billing.customerName")}
                  </span>
                  {watchedCustomerName || watchedCustomerPhone ? (
                    /* Selected customer chip */
                    <div className="flex items-center gap-2 rounded-xl border border-border-default bg-surface px-3 py-2">
                      <Users size={15} aria-hidden className="shrink-0 text-slate-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {watchedCustomerName || "—"}
                        </p>
                        {watchedCustomerPhone && (
                          <p className="text-xs text-slate-500 font-mono truncate">
                            {watchedCustomerPhone}
                          </p>
                        )}
                      </div>
                      {/* Edit button — opens sheet to change */}
                      <button
                        type="button"
                        onClick={() => setCustomerSheetOpen(true)}
                        aria-label={t("billing.pickCustomer")}
                        className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-surface-soft hover:text-slate-600 transition-colors"
                      >
                        <Search size={14} aria-hidden />
                      </button>
                      {/* Clear button */}
                      <button
                        type="button"
                        onClick={() => {
                          form.setValue("customerName", "", { shouldDirty: true });
                          form.setValue("customerPhone", "", { shouldDirty: true });
                        }}
                        aria-label={t("billing.clearCustomer")}
                        className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-danger-soft hover:text-danger transition-colors"
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </div>
                  ) : (
                    /* Empty state — "Select customer" button */
                    <button
                      type="button"
                      onClick={() => setCustomerSheetOpen(true)}
                      className={clsx(
                        "flex items-center gap-2 w-full rounded-xl border border-dashed border-border-default",
                        "bg-surface px-3 py-2.5 text-sm text-slate-500",
                        "hover:border-border-strong hover:bg-surface-soft hover:text-slate-700 transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                      )}
                    >
                      <Users size={15} aria-hidden className="shrink-0" />
                      <span>{t("billing.pickCustomer")}</span>
                    </button>
                  )}
                </div>
                {/* Not a FormField: its <label> would bind to the first radio
                    (Cash) and pollute that radio's accessible name. The
                    radiogroup already self-labels via aria-label. */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                    {t("billing.paymentMethod")}
                  </span>
                  <PaymentMethodControl
                    value={watchedPaymentMethod as BillFormSchema["paymentMethod"]}
                    onChange={(v) =>
                      form.setValue("paymentMethod", v, { shouldDirty: true })
                    }
                    label={t("billing.paymentMethod")}
                    available={availablePaymentMethods}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {canDiscount && (
                    <FormField label={t("billing.discount")}>
                      <MoneyInputRHF
                        name="discountAmount"
                        control={form.control}
                        currency={currency}
                        min={0}
                        onKeyDown={dismissKeyboardOnEnter}
                      />
                    </FormField>
                  )}
                  {taxEnabled && (
                    <FormField label={t("billing.tax")}>
                      <MoneyInputRHF
                        name="taxAmount"
                        control={form.control}
                        currency={currency}
                        min={0}
                        onKeyDown={dismissKeyboardOnEnter}
                      />
                    </FormField>
                  )}
                </div>

                {watchedPaymentMethod === "card" ? null : (
                  <FormField
                    label={
                      isCreditSale
                        ? t("billing.paidNow")
                        : t("billing.actualPaid")
                    }
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <MoneyInput
                          value={
                            Number.isFinite(actualPaidAmount)
                              ? actualPaidAmount
                              : 0
                          }
                          currency={currency}
                          min={0}
                          onKeyDown={dismissKeyboardOnEnter}
                          onValueChange={(v) => {
                            setIsPaidAmountManuallyEdited(true);
                            form.setValue("paidAmount", v, {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                          }}
                          className="flex-1"
                        />
                        {isPaidAmountManuallyEdited && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsPaidAmountManuallyEdited(false)}
                          >
                            {t("common.reset")}
                          </Button>
                        )}
                      </div>
                      {watchedPaymentMethod === "cash" && (
                        <div className="flex flex-wrap gap-1.5">
                          {/* Exact — always first: resets to the bill total */}
                          <button
                            type="button"
                            onClick={() => setIsPaidAmountManuallyEdited(false)}
                            className="rounded-lg border border-border-default bg-surface px-2.5 py-1 text-xs font-semibold text-fg-muted hover:bg-surface-soft hover:border-border-strong transition-colors"
                          >
                            {t("billing.exact")}
                          </button>
                          {/* Context-aware round-up denominations — 3 chips
                              computed from the live bill total so they are
                              always >= total and meaningful to the cashier. */}
                          {smartCashChips(billSummary.totalAmount).map(
                            (amount) => (
                              <button
                                key={amount}
                                type="button"
                                onClick={() => {
                                  setIsPaidAmountManuallyEdited(true);
                                  form.setValue("paidAmount", amount, {
                                    shouldDirty: true,
                                    shouldValidate: true,
                                  });
                                }}
                                className="rounded-lg border border-border-default bg-surface px-2.5 py-1 text-xs font-semibold text-fg-secondary tabular-nums hover:bg-surface-soft hover:border-border-strong transition-colors"
                              >
                                {formatCurrency(amount, currency)}
                              </button>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  </FormField>
                )}

                <FormField label={t("billing.notes")}>
                  <Input {...form.register("notes")} />
                </FormField>

                {/* Totals card */}
                <div className="rounded-xl border border-border-default bg-surface-soft/60 px-4 py-3">
                  <SummaryRow
                    label={t("billing.subtotal")}
                    value={formatCurrency(billSummary.subtotal, currency)}
                  />
                  <SummaryRow
                    label={t("billing.total")}
                    value={formatCurrency(billSummary.totalAmount, currency)}
                    highlight
                  />
                  {actualChangeAmount > 0.001 && (
                    <>
                      <SummaryRow
                        label={t("billing.changeDueBack")}
                        value={formatCurrency(actualChangeAmount, currency)}
                        highlight
                      />
                      <p className="pt-2 text-xs text-fg-muted">
                        {t("billing.changeHelper")}
                      </p>
                    </>
                  )}
                  {isCreditSale && amountDue > 0.001 && (
                    <SummaryRow
                      label={t("billing.amountDue")}
                      value={formatCurrency(amountDue, currency)}
                      highlight
                    />
                  )}
                </div>

                {shiftBlocked && (
                  <p className="text-xs text-danger font-medium">
                    {t("billing.shiftRequiredError")}
                  </p>
                )}

                {discountExceedsLimit && (
                  <p className="text-xs text-danger font-medium">
                    {t("billing.discountLimitExceeded", {
                      limit: formatCurrency(discountLimit, currency),
                    })}
                  </p>
                )}

                {!hasValidTotal && draftItems.length > 0 && (
                  <p className="text-xs text-danger font-medium">
                    {t("billing.invalidTotal")}
                  </p>
                )}

                {isCreditSale &&
                  !hasCreditCustomer &&
                  draftItems.length > 0 && (
                    <p className="text-xs text-danger font-medium">
                      {t("billing.creditCustomerRequired")}
                    </p>
                  )}


                {hasValidTotal &&
                  !hasEnoughPayment &&
                  draftItems.length > 0 && (
                    <p className="text-xs text-danger font-medium">
                      {t("billing.paidBelowTotal")}
                    </p>
                  )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={clearDraft}
                    className="flex-1"
                  >
                    {t("billing.clearDraft")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={!canFinalize}
                    className="flex-1"
                  >
                    {t("billing.reviewFinalize")}
                  </Button>
                </div>
              </form>
          </Card>
        </div>
      </div>

      {draftItems.length > 0 && (
        // Sticky mobile checkout bar. Only renders on <lg because the
        // desktop layout already has a persistent right-rail summary.
        // pb-safe handles the iOS home-indicator gap; the bar itself is
        // pinned with `bottom-0` and overlays the page (z-30 sits below
        // modals at z-50). The shopping-cart icon visually anchors the
        // totals so the bar reads as "your cart" not "random sticky strip".
        <div
          className={clsx(
            "fixed inset-x-0 bottom-0 z-30 lg:hidden",
            "border-t border-border-default bg-surface/95 backdrop-blur",
            "shadow-[0_-8px_24px_rgba(11,18,32,0.10)]",
            "px-3 pt-3 pb-safe",
          )}
        >
          <div className="mx-auto flex max-w-screen-sm items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <ShoppingCart size={20} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-fg-muted">
                {draftItems.length} {t("billing.items")}
              </p>
              <FitText
                value={formatCurrency(billSummary.totalAmount, currency)}
                size="lg"
                className="font-black text-fg"
              />
            </div>
            <Button
              type="button"
              size="lg"
              disabled={!canFinalize}
              onClick={form.handleSubmit(() => setConfirmOpen(true))}
              className="min-w-[140px]"
            >
              {t("billing.reviewFinalize")}
            </Button>
          </div>
        </div>
      )}

      {/* ── Confirm modal ────────────────────────────────────────────────── */}
      <Modal
        open={confirmOpen}
        title={t("billing.finalizeBill")}
        description={t("billing.finalizeDesc")}
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={form.handleSubmit(finalize)}>
              {t("billing.confirmSave")}
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-border-default bg-surface-soft/60 px-4 py-3">
          <SummaryRow
            label={t("billing.customerName")}
            value={watchedCustomerName || watchedCustomerPhone || t("common.walkin")}
          />
          <SummaryRow
            label={t("billing.items")}
            value={String(draftItems.length)}
          />
          <SummaryRow
            label={t("billing.total")}
            value={formatCurrency(billSummary.totalAmount, currency)}
            highlight
          />
          <SummaryRow
            label={t("billing.paid")}
            value={formatCurrency(actualPaidAmount, currency)}
          />
          {actualChangeAmount > 0.001 && (
            <SummaryRow
              label={t("billing.changeDueBack")}
              value={formatCurrency(actualChangeAmount, currency)}
              highlight
            />
          )}
          {isCreditSale && amountDue > 0.001 && (
            <SummaryRow
              label={t("billing.amountDue")}
              value={formatCurrency(amountDue, currency)}
              highlight
            />
          )}
        </div>
      </Modal>

      {/* ── Misc item modal ──────────────────────────────────────────────── */}
      <Modal
        open={miscOpen}
        title={t("billing.addMiscItem")}
        description={t("billing.miscItemDesc")}
        onClose={() => {
          setMiscOpen(false);
          resetMiscForm();
        }}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setMiscOpen(false);
                resetMiscForm();
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={() => addMiscLine()}>
              {t("billing.addMiscToBill")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <FormField label={t("billing.miscDescription")}>
            <Input
              value={miscDescription}
              onChange={(e) => setMiscDescription(e.target.value)}
              placeholder={t("billing.miscDescriptionPlaceholder")}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("billing.miscQuantity")}>
              <NumberField
                value={Number(miscQuantity) || 1}
                onValueChange={(v) => setMiscQuantity(String(v))}
                precision="integer"
                min={1}
                showStepper
                align="center"
                onKeyDown={dismissKeyboardOnEnter}
              />
            </FormField>
            <FormField label={t("billing.miscPrice")}>
              <MoneyInput
                value={miscPrice === "" ? "" : Number(miscPrice)}
                onValueChange={(v) => setMiscPrice(String(v))}
                currency={currency}
                min={0}
                onKeyDown={dismissKeyboardOnEnter}
              />
            </FormField>
          </div>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 5, 10].map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => setMiscPrice(String(amount))}
                className="rounded-lg border border-border-default bg-surface px-3 py-1.5 text-xs font-semibold text-fg-secondary tabular-nums hover:bg-surface-soft hover:border-border-strong transition-colors"
              >
                {formatCurrency(amount, currency)}
              </button>
            ))}
          </div>
          <p className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
            {t("billing.miscProfitNote")}
          </p>
        </div>
      </Modal>

      {/* ── Customer select sheet ────────────────────────────────────────── */}
      <Modal
        open={customerSheetOpen}
        title={t("billing.pickCustomer")}
        onClose={() => {
          setCustomerSheetOpen(false);
          setCustomerSearch("");
        }}
      >
        <div className="flex flex-col gap-3" onKeyDown={blurInputOnEnter}>
          {/* Search input */}
          <div className="relative">
            <Search
              size={15}
              aria-hidden
              className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            />
            <input
              type="text"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder={t("billing.searchCustomers")}
              aria-label={t("billing.searchCustomers")}
              className={clsx(
                "w-full rounded-xl border border-border-default bg-surface py-2 ps-9 pe-3",
                "text-sm text-slate-800 placeholder:text-slate-400",
                "focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-border-strong",
                "[font-size:16px]", // prevents mobile zoom
              )}
            />
          </div>

          {/* Customer list */}
          {(() => {
            const needle = customerSearch.trim().toLowerCase();
            const phoneNeedle = normalizePhone(customerSearch);
            const filtered = (customers ?? [])
              .filter((c) => {
                if (!needle && !phoneNeedle) return true;
                const nameMatches = c.name.toLowerCase().includes(needle);
                const phoneMatches = Boolean(
                  phoneNeedle &&
                    ((c.normalizedPhone ?? normalizePhone(c.phone)).includes(phoneNeedle)),
                );
                return nameMatches || phoneMatches;
              })
              .slice(0, 20);

            if (filtered.length === 0) {
              return (
                <p className="py-4 text-center text-sm text-slate-500">
                  {t("billing.noCustomersFound")}
                </p>
              );
            }

            return (
              <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-border-default">
                {filtered.map((customer) => (
                  <li key={customer.id}>
                    <button
                      type="button"
                      onClick={() => {
                        selectCustomer(customer);
                        setCustomerSheetOpen(false);
                        setCustomerSearch("");
                      }}
                      className="w-full text-start px-3 py-2.5 hover:bg-surface-soft transition-colors"
                    >
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {customer.name}
                      </p>
                      {customer.phone && (
                        <p className="text-xs text-slate-500 font-mono">
                          {customer.phone}
                        </p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            );
          })()}

          {/* Manual entry section — for customers not yet in the database */}
          <details className="group rounded-2xl border border-border-subtle bg-surface-soft/70 p-3 open:bg-brand-soft/30">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <UserPlus size={16} aria-hidden />
                </span>
                {t("billing.enterManually")}
              </span>
              <span className="text-lg leading-none text-slate-400 transition-transform group-open:rotate-90">›</span>
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-xs leading-5 text-slate-500">
                {t("billing.manualCustomerHint")}
              </p>
              <Input
                type="text"
                placeholder={t("billing.customerName")}
                aria-label={t("billing.customerName")}
                value={manualCustomerName}
                onChange={(e) => setManualCustomerName(e.target.value)}
                inputSize="lg"
                leftSlot={<Users size={17} aria-hidden />}
                className="[font-size:16px]"
                autoComplete="name"
              />
              <Input
                type="tel"
                inputMode="tel"
                placeholder={t("billing.customerPhone")}
                aria-label={t("billing.customerPhone")}
                value={manualCustomerPhone}
                onChange={(e) => setManualCustomerPhone(e.target.value)}
                inputSize="lg"
                leftSlot={<Phone size={17} aria-hidden />}
                className="[font-size:16px]"
                autoComplete="tel"
                dir="ltr"
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  fullWidth
                  onClick={() => {
                    setCustomerSheetOpen(false);
                    setCustomerSearch("");
                  }}
                  disabled={isSavingCustomer}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  fullWidth
                  onClick={saveManualCustomer}
                  disabled={!canSaveManualCustomer}
                  loading={isSavingCustomer}
                >
                  {t("billing.saveCustomer")}
                </Button>
              </div>
            </div>
          </details>
        </div>
      </Modal>

      <QuickProductModal
        open={quickAddOpen}
        barcode={missingBarcode}
        currency={currency}
        onClose={() => {
          setQuickAddOpen(false);
          setMissingBarcode("");
          setTimeout(() => barcodeInputRef.current?.focus(), 0);
        }}
        onCreated={handleQuickProductCreated}
      />

      {/* ── Barcode scanner modal ─────────────────────────────────────────── */}
      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => {
          setScannerOpen(false);
          setTimeout(() => barcodeInputRef.current?.focus(), 0);
        }}
        title={t("billing.scanProduct")}
        description={t("billing.scanProductDesc")}
        onDetected={handleScanForBill}
        continuous
      />

      {/* ── Weight picker (weight products only) ───────────────────────────── */}
      <WeightEditorModal
        open={Boolean(weightEditor)}
        product={weightEditor?.product ?? null}
        initialGrams={weightEditor?.initialGrams}
        currency={currency}
        onConfirm={commitWeight}
        onClose={() => {
          setWeightEditor(null);
          setTimeout(() => barcodeInputRef.current?.focus(), 0);
        }}
      />
    </>
  );
}

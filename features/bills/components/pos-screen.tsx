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
  calculateBillTotals,
  calculateChange,
  calculateLineSubtotal,
} from "@/lib/utils/calculations";
import { MONEY_EPSILON, formatCurrency } from "@/lib/utils/money";
import { createFinalizedBill } from "@/lib/services/billing-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Check,
  CircleCheck,
  Cloud,
  CloudUpload,
  ReceiptText,
  Search,
  ShoppingCart,
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
import { PaymentMethodControl } from "@/components/pos/payment-method-control";
import { QuickProductModal } from "./quick-product-modal";
import { ReceiptView } from "./receipt-view";
import { normalizeBarcode } from "@/lib/utils/barcode";
import { useAuth } from "@/components/providers/auth-context";
import { usePermissions } from "@/lib/hooks/use-permissions";
import type {
  Bill,
  BillDraftItem,
  BillItem,
  Customer,
  Product,
  Settings,
} from "@/types/domain";

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

      <div className="rounded-xl bg-success-soft border border-success-soft px-4 py-3">
        <SummaryRow
          label={t("billing.total")}
          value={formatCurrency(bill.totalAmount, currency)}
          highlight
        />
        <SummaryRow
          label={t("billing.change")}
          value={formatCurrency(bill.changeAmount, currency)}
        />
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
  const customers = useLiveQuery(() => customerRepo.list(), []);
  const activeShift = useLiveQuery(() => getActiveShift(), []);
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const { push } = useToast();
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
  const staleDraftChecked = useRef(false);
  const [productId, setProductId] = useState("");
  const [barcodeQuery, setBarcodeQuery] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [customerSheetOpen, setCustomerSheetOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
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

  const [lastAdded, setLastAdded] = useState<{
    name: string;
    qty: number;
    subtotal: number;
  } | null>(null);
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
    barcodeInputRef.current?.focus();
  }, []);

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
      // The auto-fill default is the bill total (or 0 for a credit sale).
      // Compare against the credit-aware default so a saved credit sale
      // (paidAmount 0) isn't mistakenly flagged as a manual override.
      const expectedDefault =
        parsed.form.paymentMethod === "credit" ? 0 : autoTotal;
      setIsPaidAmountManuallyEdited(
        Math.abs((parsed.form.paidAmount ?? 0) - expectedDefault) > 0.001,
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
  const watchedCashAmount = Number(form.watch("cashAmount") || 0);
  const watchedCardAmount = Number(form.watch("cardAmount") || 0);
  const watchedNotes = form.watch("notes");

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
        cashAmount: watchedCashAmount,
        cardAmount: watchedCardAmount,
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
    watchedCashAmount,
    watchedCardAmount,
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
  const isMixedSale = watchedPaymentMethod === "mixed";
  const defaultPaidAmount = isCreditSale
    ? 0
    : Number(billSummary.totalAmount.toFixed(2));
  const actualPaidAmount = isPaidAmountManuallyEdited
    ? watchedPaidAmount
    : defaultPaidAmount;
  const actualChangeAmount = useMemo(
    () => calculateChange(actualPaidAmount, billSummary.totalAmount),
    [actualPaidAmount, billSummary.totalAmount],
  );
  const amountDue = Math.max(
    0,
    calculateChange(billSummary.totalAmount, actualPaidAmount),
  );
  const mixedSumDelta = useMemo(
    () =>
      isMixedSale
        ? Math.abs(
            watchedCashAmount + watchedCardAmount - billSummary.totalAmount,
          )
        : 0,
    [
      isMixedSale,
      watchedCashAmount,
      watchedCardAmount,
      billSummary.totalAmount,
    ],
  );
  const isMixedSplitValid = !isMixedSale || mixedSumDelta < MONEY_EPSILON;
  const hasCreditCustomer = Boolean(
    watchedCustomerName?.trim() || watchedCustomerPhone?.trim(),
  );

  // (Customer typeahead removed — replaced by CustomerSelectSheet modal)

  function selectCustomer(customer: Customer) {
    form.setValue("customerName", customer.name, { shouldDirty: true });
    form.setValue("customerPhone", customer.phone ?? "", { shouldDirty: true });
  }
  const hasValidTotal = billSummary.totalAmount >= 0;
  const hasEnoughPayment =
    isCreditSale || isMixedSale || actualChangeAmount >= 0;
  const canFinalize =
    draftItems.length > 0 &&
    hasValidTotal &&
    hasEnoughPayment &&
    isMixedSplitValid &&
    (!isCreditSale || hasCreditCustomer);

  useEffect(() => {
    if (isPaidAmountManuallyEdited) return;
    form.setValue("paidAmount", defaultPaidAmount, {
      shouldDirty: false,
      shouldValidate: true,
    });
  }, [defaultPaidAmount, isPaidAmountManuallyEdited, form]);

  // When the user switches to 'mixed' the previous cash/card values (likely 0
  // from cash/card/credit modes) leave the sum at zero — pre-fill with the
  // current total going to cash so the split is valid on entry. The cashier
  // can then move some amount to the card field.
  useEffect(() => {
    if (!isMixedSale) return;
    const total = Number(billSummary.totalAmount.toFixed(2));
    if (Math.abs(watchedCashAmount + watchedCardAmount - total) < MONEY_EPSILON)
      return;
    form.setValue("cashAmount", total, {
      shouldDirty: false,
      shouldValidate: false,
    });
    form.setValue("cardAmount", 0, {
      shouldDirty: false,
      shouldValidate: false,
    });
    // Intentionally only depend on isMixedSale + total — moving the split
    // around afterwards is the cashier's job, not auto-correction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMixedSale, billSummary.totalAmount, form]);

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

  // Last-scanned banner fades out after a couple of seconds — long enough for
  // the cashier to glance and confirm, short enough not to obscure the next
  // scan's feedback.
  useEffect(() => {
    if (!lastAdded) return;
    const id = window.setTimeout(() => setLastAdded(null), 2500);
    return () => window.clearTimeout(id);
  }, [lastAdded]);

  // Global Ctrl/Cmd+Enter opens the finalize confirm modal so the cashier
  // can finish a sale without leaving the keyboard. Skipped when any modal
  // is already open (Esc handles those) and when nothing is finalizable.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (confirmOpen || scannerOpen || quickAddOpen || lastFinalized) return;
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
    lastFinalized,
    canFinalize,
    form,
  ]);

  // ── FIXED double-toast: push() is called OUTSIDE setDraftItems updater ──
  function appendProduct(product: Product) {
    if (product.quantityInStock <= 0) {
      push(t("billing.outOfStock"), "error");
      return;
    }

    // Adding the first item of the next sale means the cashier has moved on
    // from the just-completed bill — collapse the success panel immediately.
    if (lastFinalized) setLastFinalized(null);

    const existing = draftItems.find((i) => i.productId === product.id);

    if (existing) {
      const nextQty = Math.min(existing.quantity + 1, product.quantityInStock);
      setDraftItems((cur) =>
        cur.map((i) =>
          i.productId === product.id ? { ...i, quantity: nextQty } : i,
        ),
      );
      push(t("billing.itemUpdated", { name: product.name, qty: nextQty }));
      setLastAdded({
        name: product.name,
        qty: nextQty,
        subtotal: calculateLineSubtotal(nextQty, product.sellPrice),
      });
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
      setLastAdded({
        name: product.name,
        qty: 1,
        subtotal: calculateLineSubtotal(1, product.sellPrice),
      });
    }

    setTimeout(() => barcodeInputRef.current?.focus(), 0);
  }

  function addBySelection() {
    const product = products?.find((p) => p.id === productId);
    if (!product) return;
    appendProduct(product);
    setProductId("");
  }

  function promptQuickAddProduct(barcode: string) {
    setScannerOpen(false);
    setBarcodeQuery("");
    setMissingBarcode(barcode);
    setQuickAddOpen(true);
    push(t("billing.productNotFoundAddNow", { barcode }), "error");
  }

  function addByBarcode() {
    const bc = normalizeBarcode(barcodeQuery);
    if (!bc) return;
    const product = products?.find((p) => normalizeBarcode(p.barcode) === bc);
    if (!product) {
      promptQuickAddProduct(bc);
      return;
    }
    appendProduct(product);
    setBarcodeQuery("");
  }

  function handleScanForBill(barcode: string) {
    const bc = normalizeBarcode(barcode);
    const product = products?.find((p) => normalizeBarcode(p.barcode) === bc);
    if (!product) {
      promptQuickAddProduct(bc);
      return;
    }
    appendProduct(product);
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

  function updateQuantity(productId: string, quantity: number) {
    // Number(""), Number("abc"), Number(".") all yield NaN/non-integer values.
    // Coerce to a safe whole number before clamping so the draft never enters
    // a state where totals/profit/tax derived from quantity become NaN.
    const safeQuantity = Number.isFinite(quantity) ? Math.trunc(quantity) : 1;
    setDraftItems((cur) =>
      cur.map((i) => {
        if (i.productId !== productId) return i;
        return {
          ...i,
          quantity: Math.max(1, Math.min(safeQuantity, i.availableStock)),
        };
      }),
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
          cashAmount: watchedCashAmount,
          cardAmount: watchedCardAmount,
        },
      });
      clearDraft();
      setConfirmOpen(false);
      setLastFinalized({ bill, items: billItems });
    } catch (error) {
      push(getServiceErrorMessage(error, t, t("billing.billFailed")), "error");
    }
  }

  const draftItemColumns: ColumnDef<BillDraftItem, unknown>[] = [
    {
      accessorKey: "name",
      header: t("billing.product"),
      cell: ({ row }) => (
        <span className="font-medium text-slate-800">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "availableStock",
      header: t("billing.stock"),
      cell: ({ row }) => (
        <span className="tabular-nums text-slate-500">
          {row.original.availableStock}
        </span>
      ),
    },
    {
      accessorKey: "quantity",
      header: t("billing.qty"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <NumberField
            value={item.quantity}
            onValueChange={(v) => updateQuantity(item.productId, v)}
            precision="integer"
            min={1}
            max={item.availableStock}
            align="center"
            onKeyDown={dismissKeyboardOnEnter}
            className="w-24"
            fullWidth={false}
          />
        );
      },
    },
    {
      accessorKey: "unitSellPrice",
      header: t("billing.sell"),
      cell: ({ row }) => (
        <span className="tabular-nums text-slate-700" dir="ltr">
          {formatCurrency(row.original.unitSellPrice, currency)}
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
              cur.filter((i) => i.productId !== row.original.productId),
            )
          }
        >
          {t("common.remove")}
        </Button>
      ),
    },
  ];

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
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-4 xl:gap-5 items-start">
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

          {lastAdded && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 rounded-xl border border-success/30 bg-success-soft px-3 py-2 text-sm text-success"
            >
              <Check
                aria-hidden
                size={16}
                strokeWidth={3}
                className="shrink-0 text-success"
              />
              <span className="font-medium truncate">{lastAdded.name}</span>
              <span className="ml-auto shrink-0 text-xs font-semibold tabular-nums text-success">
                ×{lastAdded.qty} ·{" "}
                {formatCurrency(lastAdded.subtotal, currency)}
              </span>
            </div>
          )}

          {/* Barcode input row */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2">
            <Input
              ref={barcodeInputRef}
              placeholder={t("billing.typeBarcode")}
              value={barcodeQuery}
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
            <Button type="button" onClick={() => setScannerOpen(true)}>
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

          {/* Product select row */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
            <SearchableSelect
              value={productId}
              onValueChange={(value) => setProductId(value ?? "")}
              options={productOptions}
              placeholder={t("billing.selectProduct")}
              searchPlaceholder={t("products.searchPlaceholder")}
              emptyMessage={t("products.noProducts")}
              disabled={!products?.length}
              className="flex-1"
            />
            <Button type="button" variant="secondary" onClick={addBySelection}>
              {t("billing.addItem")}
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
                    key={item.productId}
                    className="touch-card rounded-2xl border border-slate-200 bg-white p-3 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate">
                          {item.name}
                        </p>
                        <p className="text-xs text-slate-500 font-mono truncate">
                          {item.barcode}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDraftItems((cur) =>
                            cur.filter((i) => i.productId !== item.productId),
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
                          {item.availableStock}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-2">
                        <p className="text-slate-500">{t("billing.sell")}</p>
                        <p
                          className="font-bold text-slate-800 tabular-nums"
                          dir="ltr"
                        >
                          {formatCurrency(item.unitSellPrice, currency)}
                        </p>
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
                        {t("billing.qty")}
                      </span>
                      <NumberField
                        value={item.quantity}
                        onValueChange={(v) => updateQuantity(item.productId, v)}
                        precision="integer"
                        min={1}
                        max={item.availableStock}
                        showStepper
                        align="center"
                        onKeyDown={dismissKeyboardOnEnter}
                        className="w-[170px]"
                        fullWidth={false}
                      />
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
                />
              </div>
            </>
          )}
        </Card>

        {/* ── Bill summary panel ───────────────────────────────────────── */}
        <div className="xl:sticky xl:top-6">
          {lastFinalized ? (
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
          ) : (
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
                <FormField label={t("billing.paymentMethod")}>
                  <PaymentMethodControl
                    value={watchedPaymentMethod as BillFormSchema["paymentMethod"]}
                    onChange={(v) =>
                      form.setValue("paymentMethod", v, { shouldDirty: true })
                    }
                    label={t("billing.paymentMethod")}
                  />
                </FormField>

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
                  <FormField label={t("billing.tax")}>
                    <MoneyInputRHF
                      name="taxAmount"
                      control={form.control}
                      currency={currency}
                      min={0}
                      onKeyDown={dismissKeyboardOnEnter}
                    />
                  </FormField>
                </div>

                {isMixedSale ? (
                  <FormField label={t("billing.mixedSplit")}>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
                          {t("common.cash")}
                        </span>
                        <MoneyInput
                          value={watchedCashAmount}
                          currency={currency}
                          min={0}
                          onKeyDown={dismissKeyboardOnEnter}
                          onValueChange={(v) => {
                            const safe = Math.max(0, v);
                            form.setValue("cashAmount", safe, {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                            // Auto-balance card so the sum lands on total.
                            form.setValue(
                              "cardAmount",
                              Math.max(0, billSummary.totalAmount - safe),
                              { shouldDirty: true, shouldValidate: false },
                            );
                          }}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
                          {t("common.card")}
                        </span>
                        <MoneyInput
                          value={watchedCardAmount}
                          currency={currency}
                          min={0}
                          onKeyDown={dismissKeyboardOnEnter}
                          onValueChange={(v) => {
                            const safe = Math.max(0, v);
                            form.setValue("cardAmount", safe, {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                            // Auto-balance cash so the sum lands on total.
                            form.setValue(
                              "cashAmount",
                              Math.max(0, billSummary.totalAmount - safe),
                              { shouldDirty: true, shouldValidate: false },
                            );
                          }}
                        />
                      </label>
                    </div>
                  </FormField>
                ) : watchedPaymentMethod === "card" ? null : (
                  <FormField label={t("billing.actualPaid")}>
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
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
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
                                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 tabular-nums hover:bg-slate-50 hover:border-slate-300 transition-colors"
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
                <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
                  <SummaryRow
                    label={t("billing.subtotal")}
                    value={formatCurrency(billSummary.subtotal, currency)}
                  />
                  <SummaryRow
                    label={t("billing.total")}
                    value={formatCurrency(billSummary.totalAmount, currency)}
                    highlight
                  />
                  <SummaryRow
                    label={t("billing.change")}
                    value={formatCurrency(
                      Math.max(0, actualChangeAmount),
                      currency,
                    )}
                    highlight
                  />
                  {isCreditSale && amountDue > 0 && (
                    <SummaryRow
                      label={t("billing.amountDue")}
                      value={formatCurrency(amountDue, currency)}
                      highlight
                    />
                  )}
                </div>

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

                {isMixedSale && !isMixedSplitValid && draftItems.length > 0 && (
                  <p className="text-xs text-danger font-medium">
                    {t("billing.mixedSumMismatch")}
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
          )}
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
              <p
                className="truncate text-lg font-black text-fg tabular-nums"
                dir="ltr"
              >
                {formatCurrency(billSummary.totalAmount, currency)}
              </p>
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
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
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
          <SummaryRow
            label={t("billing.change")}
            value={formatCurrency(Math.max(0, actualChangeAmount), currency)}
            highlight
          />
          {isCreditSale && amountDue > 0 && (
            <SummaryRow
              label={t("billing.amountDue")}
              value={formatCurrency(amountDue, currency)}
              highlight
            />
          )}
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
        <div className="flex flex-col gap-3">
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
            const filtered = (customers ?? [])
              .filter(
                (c) =>
                  !needle ||
                  c.name.toLowerCase().includes(needle) ||
                  c.normalizedPhone?.includes(normalizePhone(customerSearch)),
              )
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
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-info hover:text-info/80 transition-colors list-none">
              <span className="rotate-0 transition-transform group-open:rotate-90">›</span>
              {t("billing.enterManually")}
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              <input
                type="text"
                placeholder={t("billing.customerName")}
                aria-label={t("billing.customerName")}
                defaultValue={watchedCustomerName}
                onBlur={(e) =>
                  form.setValue("customerName", e.target.value.trim(), {
                    shouldDirty: true,
                  })
                }
                className={clsx(
                  "w-full rounded-xl border border-border-default bg-surface px-3 py-2",
                  "text-sm text-slate-800 placeholder:text-slate-400",
                  "focus:outline-none focus:ring-2 focus:ring-brand/30",
                  "[font-size:16px]",
                )}
              />
              <input
                type="tel"
                placeholder={t("billing.customerPhone")}
                aria-label={t("billing.customerPhone")}
                defaultValue={watchedCustomerPhone}
                onBlur={(e) =>
                  form.setValue("customerPhone", e.target.value.trim(), {
                    shouldDirty: true,
                  })
                }
                className={clsx(
                  "w-full rounded-xl border border-border-default bg-surface px-3 py-2",
                  "text-sm text-slate-800 placeholder:text-slate-400",
                  "focus:outline-none focus:ring-2 focus:ring-brand/30",
                  "[font-size:16px]",
                )}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setCustomerSheetOpen(false);
                  setCustomerSearch("");
                }}
              >
                {t("common.close")}
              </Button>
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
    </>
  );
}

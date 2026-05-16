"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { createFinalizedBill } from "@/lib/services/billing-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { LoadingState } from "@/components/ui/loading-state";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form-field";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import { TableShell } from "@/components/ui/table-shell";
import { Toolbar } from "@/components/ui/toolbar";
import { useToast } from "@/components/ui/toast";
import { BarcodeScannerModal } from "@/components/barcode/barcode-scanner-modal";
import { useLocale } from "@/components/providers/locale-context";
import { PriceDisplay } from "@/components/pos/price-display";
import { StockBadge } from "@/components/pos/stock-badge";
import { CheckoutActionBar } from "@/components/pos/checkout-action-bar";
import {
  alertTones,
  buttonVariants,
  panelTones,
  typographyClasses,
} from "@/lib/design/variants";
import { QuickProductModal } from "./quick-product-modal";
import { ReceiptView } from "./receipt-view";
import { normalizeBarcode } from "@/lib/utils/barcode";
import { useAuth } from "@/components/providers/auth-context";
import type {
  Bill,
  BillDraftItem,
  BillItem,
  Customer,
  Product,
  Settings,
} from "@/types/domain";

const SUCCESS_AUTO_DISMISS_MS = 8000;

// Draft key is scoped per signed-in user so two cashiers sharing a browser
// don't see each other's in-progress carts. Pre-uid drafts under the old
// flat "shopkeeper-pos-bill-draft-v1" key are intentionally orphaned (no
// data is lost — Dexie still has every saved bill — only the in-progress
// scratch state is dropped on the migration).
const POS_DRAFT_KEY_PREFIX = "shopkeeper-pos-bill-draft-v1";

function SummaryRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-2 last:border-0">
      <span
        className={
          highlight
            ? "text-sm font-semibold text-slate-900"
            : typographyClasses.bodyMuted
        }
      >
        {label}
      </span>
      <span
        className={
          highlight
            ? "text-sm font-bold tabular-nums text-slate-900"
            : "text-sm font-medium tabular-nums text-slate-700"
        }
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

  useEffect(() => {
    newSaleRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <SectionCard tone="success" padding="md">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700 text-lg font-bold"
        >
          ✓
        </span>
        <div className="min-w-0 flex-1">
          <StatusPill
            status="completed"
            tone="success"
            label={t("billing.saleCompleted")}
          />
          <p className="sr-only">{t("billing.saleCompleted")}</p>
          <p className="font-mono text-base font-bold text-slate-900">
            {bill.billNumber}
          </p>
        </div>
      </div>

      <div className={panelTones.success + " rounded-xl border px-4 py-3"}>
        <SummaryRow
          label={t("billing.total")}
          value={
            <PriceDisplay
              value={bill.totalAmount}
              currency={currency}
              emphasis
            />
          }
          highlight
        />
        <SummaryRow
          label={t("billing.change")}
          value={<PriceDisplay value={bill.changeAmount} currency={currency} />}
        />
        {amountDue > 0 && (
          <SummaryRow
            label={t("billing.amountDue")}
            value={
              <PriceDisplay value={amountDue} currency={currency} emphasis />
            }
            highlight
          />
        )}
      </div>

      <ReceiptView bill={bill} items={items} settings={settings} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Link
          href={`/bills/${bill.id}`}
          className={
            buttonVariants.outline +
            " inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold"
          }
        >
          {t("billing.openBillDetail")}
        </Link>
        <Button
          ref={newSaleRef}
          type="button"
          onClick={onDismiss}
          className="w-full"
        >
          {t("billing.newSale")}
        </Button>
      </div>
    </SectionCard>
  );
}

export function PosScreen() {
  const { t } = useLocale();
  const { user } = useAuth();
  const products = useLiveQuery(
    () => db.products.where("status").equals("active").sortBy("name"),
    [],
  );
  const customers = useLiveQuery(() => customerRepo.list(), []);
  const activeShift = useLiveQuery(() => getActiveShift(), []);
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const { push } = useToast();
  const currency = settings?.currency ?? "USD";
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
  const [productId, setProductId] = useState("");
  const [barcodeQuery, setBarcodeQuery] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [missingBarcode, setMissingBarcode] = useState("");
  const [isPaidAmountManuallyEdited, setIsPaidAmountManuallyEdited] =
    useState(false);
  const [lastFinalized, setLastFinalized] = useState<{
    bill: Bill;
    items: BillItem[];
  } | null>(null);
  const [lastAdded, setLastAdded] = useState<{
    name: string;
    qty: number;
    subtotal: number;
  } | null>(null);
  const [customerFieldFocused, setCustomerFieldFocused] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const lastAppliedCashierNameRef = useRef("Owner");

  const form = useForm<BillFormSchema>({
    resolver: zodResolver(billFormSchema),
    defaultValues: {
      cashierName: settings?.cashierName ?? "Owner",
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
    const nextDefault = settings.cashierName || "Owner";
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
        Math.abs(parsed.form.paidAmount - autoTotal) > 0.001,
      );
    } catch {
      window.localStorage.removeItem(draftKey);
    }
  }, [draftKey, form]);

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
  const isMixedSplitValid = !isMixedSale || mixedSumDelta < 0.005;
  const hasCreditCustomer = Boolean(
    watchedCustomerName?.trim() || watchedCustomerPhone?.trim(),
  );

  // Typeahead: match the typed name/phone against the customers table. Filter
  // out cases where the cashier has already selected an exact-match customer
  // (no need to suggest the same row they're already on).
  const customerSuggestions = useMemo<Customer[]>(() => {
    if (!customers || customers.length === 0) return [];
    if (!customerFieldFocused) return [];
    const nameNeedle = watchedCustomerName?.trim().toLowerCase() ?? "";
    const phoneNeedle = normalizePhone(watchedCustomerPhone ?? "");
    if (!nameNeedle && !phoneNeedle) return [];
    const matches = customers.filter((customer) => {
      const nameMatches =
        nameNeedle && customer.name.toLowerCase().includes(nameNeedle);
      const phoneMatches =
        phoneNeedle && customer.normalizedPhone?.includes(phoneNeedle);
      return Boolean(nameMatches || phoneMatches);
    });
    // Hide the suggestion if the only match is already an exact one to avoid
    // showing a "you already picked this" row.
    if (matches.length === 1) {
      const m = matches[0];
      const exactName =
        m.name.toLowerCase() === nameNeedle &&
        (phoneNeedle === "" || m.normalizedPhone === phoneNeedle);
      const exactPhone =
        m.normalizedPhone === phoneNeedle &&
        (nameNeedle === "" || m.name.toLowerCase() === nameNeedle);
      if (exactName || exactPhone) return [];
    }
    return matches.slice(0, 5);
  }, [
    customers,
    customerFieldFocused,
    watchedCustomerName,
    watchedCustomerPhone,
  ]);

  function selectCustomer(customer: Customer) {
    form.setValue("customerName", customer.name, { shouldDirty: true });
    form.setValue("customerPhone", customer.phone ?? "", { shouldDirty: true });
    setCustomerFieldFocused(false);
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
    if (Math.abs(watchedCashAmount + watchedCardAmount - total) < 0.005) return;
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
      cashierName: settings?.cashierName ?? "Owner",
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
      push(
        error instanceof Error ? error.message : t("billing.billFailed"),
        "error",
      );
    }
  }

  if (!products) {
    return <LoadingState title={t("billing.loadingPos")} />;
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
          className={
            alertTones.warning +
            " mb-4 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors hover:bg-amber-100"
          }
        >
          <span className="font-medium">{t("billing.noShiftOpenWarning")}</span>
          <span className="text-xs font-semibold uppercase tracking-wide">
            {t("billing.openShift")} →
          </span>
        </Link>
      )}

      {/* Mobile-first layout, desktop keeps two columns */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-4 xl:gap-5 items-start">
        {/* ── Build bill panel ─────────────────────────────────────────── */}
        <SectionCard
          title={t("billing.buildBill")}
          padding="md"
          actions={
            draftItems.length > 0 ? (
              <Badge tone="info">
                {draftItems.length} {t("billing.items")}
              </Badge>
            ) : undefined
          }
        >
          {lastAdded && (
            <div
              role="status"
              aria-live="polite"
              className={
                alertTones.success +
                " flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
              }
            >
              <span aria-hidden className="text-green-600">
                ✓
              </span>
              <span className="font-medium truncate">{lastAdded.name}</span>
              <span className="ml-auto shrink-0 text-xs font-semibold tabular-nums text-green-700">
                ×{lastAdded.qty} ·{" "}
                <PriceDisplay
                  value={lastAdded.subtotal}
                  currency={currency}
                  size="sm"
                />
              </span>
            </div>
          )}

          {/* Barcode input row */}
          <Toolbar align="between" wrap>
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
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
                <Button
                  type="button"
                  aria-label={t("billing.shortcutsHelp")}
                  aria-expanded={helpOpen}
                  onClick={() => setHelpOpen((open) => !open)}
                  variant="outline"
                  size="icon"
                >
                  ?
                </Button>
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
          </Toolbar>

          {/* Product select row */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
            <Select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="flex-1"
            >
              <option value="">{t("billing.selectProduct")}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.quantityInStock}{" "}
                  {t("billing.stock").toLowerCase()})
                </option>
              ))}
            </Select>
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
                      <div
                        className={
                          panelTones.neutral + " rounded-xl border p-2"
                        }
                      >
                        <p className="text-slate-500">{t("billing.stock")}</p>
                        <StockBadge
                          quantity={item.availableStock}
                          minQuantity={null}
                        />
                      </div>
                      <div
                        className={
                          panelTones.neutral + " rounded-xl border p-2"
                        }
                      >
                        <p className="text-slate-500">{t("billing.sell")}</p>
                        <PriceDisplay
                          value={item.unitSellPrice}
                          currency={currency}
                          emphasis
                        />
                      </div>
                      <div
                        className={
                          panelTones.neutral + " rounded-xl border p-2"
                        }
                      >
                        <p className="text-slate-500">
                          {t("billing.subtotalCol")}
                        </p>
                        <PriceDisplay
                          value={calculateLineSubtotal(
                            item.quantity,
                            item.unitSellPrice,
                          )}
                          currency={currency}
                          emphasis
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-slate-600">
                        {t("billing.qty")}
                      </span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        enterKeyHint="done"
                        min={1}
                        max={item.availableStock}
                        value={item.quantity}
                        onChange={(e) =>
                          updateQuantity(item.productId, Number(e.target.value))
                        }
                        onKeyDown={dismissKeyboardOnEnter}
                        className="w-28 text-center"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <TableShell className="hidden md:block">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {[
                        t("billing.product"),
                        t("billing.stock"),
                        t("billing.qty"),
                        t("billing.sell"),
                        t("billing.subtotalCol"),
                        "",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2.5 text-start text-xs font-semibold text-slate-500 uppercase tracking-wide"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draftItems.map((item) => (
                      <tr
                        key={item.productId}
                        className="hover:bg-slate-50/50 transition-colors"
                      >
                        <td className="px-3 py-2.5 font-medium text-slate-800">
                          {item.name}
                        </td>
                        <td className="px-3 py-2.5 text-slate-500 tabular-nums">
                          <StockBadge
                            quantity={item.availableStock}
                            minQuantity={null}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <Input
                            type="number"
                            inputMode="numeric"
                            enterKeyHint="done"
                            min={1}
                            max={item.availableStock}
                            value={item.quantity}
                            onChange={(e) =>
                              updateQuantity(
                                item.productId,
                                Number(e.target.value),
                              )
                            }
                            onKeyDown={dismissKeyboardOnEnter}
                            className="w-20 text-center"
                          />
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-700">
                          <PriceDisplay
                            value={item.unitSellPrice}
                            currency={currency}
                          />
                        </td>
                        <td className="px-3 py-2.5 tabular-nums font-medium text-slate-800">
                          <PriceDisplay
                            value={calculateLineSubtotal(
                              item.quantity,
                              item.unitSellPrice,
                            )}
                            currency={currency}
                            emphasis
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setDraftItems((cur) =>
                                cur.filter(
                                  (i) => i.productId !== item.productId,
                                ),
                              )
                            }
                          >
                            {t("common.remove")}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            </>
          )}
        </SectionCard>

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
            <SectionCard title={t("billing.billSummary")} padding="md">
              <form
                className="flex flex-col gap-3"
                onSubmit={form.handleSubmit(() => setConfirmOpen(true))}
              >
                <FormField label={t("billing.cashierName")}>
                  <Input {...form.register("cashierName")} />
                </FormField>
                <div className="relative flex flex-col gap-3">
                  <FormField label={t("billing.customerName")}>
                    <Input
                      {...form.register("customerName")}
                      onFocus={() => setCustomerFieldFocused(true)}
                      onBlur={() => {
                        // Delay so a click on a suggestion can still register.
                        window.setTimeout(
                          () => setCustomerFieldFocused(false),
                          120,
                        );
                      }}
                    />
                  </FormField>
                  <FormField label={t("billing.customerPhone")}>
                    <Input
                      {...form.register("customerPhone")}
                      onFocus={() => setCustomerFieldFocused(true)}
                      onBlur={() => {
                        window.setTimeout(
                          () => setCustomerFieldFocused(false),
                          120,
                        );
                      }}
                    />
                  </FormField>
                  {customerSuggestions.length > 0 && (
                    <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-44 overflow-auto rounded-xl border border-slate-200 bg-white shadow-md divide-y divide-slate-100">
                      {customerSuggestions.map((customer) => (
                        <li key={customer.id}>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => selectCustomer(customer)}
                            className="w-full text-start px-3 py-2 hover:bg-slate-50"
                          >
                            <p className="text-sm font-medium text-slate-800 truncate">
                              {customer.name}
                            </p>
                            {customer.phone && (
                              <p className="text-xs text-slate-500 font-mono truncate">
                                {customer.phone}
                              </p>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <FormField label={t("billing.paymentMethod")}>
                  <Select {...form.register("paymentMethod")}>
                    <option value="cash">{t("common.cash")}</option>
                    <option value="card">{t("common.card")}</option>
                    <option value="mixed">{t("common.mixed")}</option>
                    <option value="credit">{t("common.credit")}</option>
                  </Select>
                </FormField>

                <div className="grid grid-cols-2 gap-3">
                  <FormField label={t("billing.discount")}>
                    <Input
                      type="number"
                      inputMode="decimal"
                      enterKeyHint="done"
                      step="0.01"
                      onKeyDown={dismissKeyboardOnEnter}
                      {...form.register("discountAmount", {
                        valueAsNumber: true,
                      })}
                    />
                  </FormField>
                  <FormField label={t("billing.tax")}>
                    <Input
                      type="number"
                      inputMode="decimal"
                      enterKeyHint="done"
                      step="0.01"
                      onKeyDown={dismissKeyboardOnEnter}
                      {...form.register("taxAmount", { valueAsNumber: true })}
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
                        <Input
                          type="number"
                          inputMode="decimal"
                          enterKeyHint="done"
                          step="0.01"
                          value={watchedCashAmount}
                          onKeyDown={dismissKeyboardOnEnter}
                          onChange={(e) => {
                            const v =
                              e.target.value === ""
                                ? 0
                                : Number(e.target.value);
                            const safe = Number.isFinite(v)
                              ? Math.max(0, v)
                              : 0;
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
                        <Input
                          type="number"
                          inputMode="decimal"
                          enterKeyHint="done"
                          step="0.01"
                          value={watchedCardAmount}
                          onKeyDown={dismissKeyboardOnEnter}
                          onChange={(e) => {
                            const v =
                              e.target.value === ""
                                ? 0
                                : Number(e.target.value);
                            const safe = Number.isFinite(v)
                              ? Math.max(0, v)
                              : 0;
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
                        <Input
                          type="number"
                          inputMode="decimal"
                          enterKeyHint="done"
                          step="0.01"
                          value={
                            Number.isFinite(actualPaidAmount)
                              ? actualPaidAmount
                              : 0
                          }
                          onKeyDown={dismissKeyboardOnEnter}
                          onChange={(e) => {
                            setIsPaidAmountManuallyEdited(true);
                            const v =
                              e.target.value === ""
                                ? 0
                                : Number(e.target.value);
                            form.setValue(
                              "paidAmount",
                              Number.isFinite(v) ? v : 0,
                              {
                                shouldDirty: true,
                                shouldValidate: true,
                              },
                            );
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
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => setIsPaidAmountManuallyEdited(false)}
                          >
                            {t("billing.exact")}
                          </Button>
                          {[5, 10, 20, 50, 100].map((denomination) => (
                            <Button
                              key={denomination}
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => {
                                setIsPaidAmountManuallyEdited(true);
                                form.setValue("paidAmount", denomination, {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                });
                              }}
                              className="tabular-nums"
                            >
                              {denomination}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </FormField>
                )}

                <FormField label={t("billing.notes")}>
                  <Input {...form.register("notes")} />
                </FormField>

                {/* Totals card */}
                <div
                  className={
                    panelTones.neutral + " rounded-xl border px-4 py-3"
                  }
                >
                  <SummaryRow
                    label={t("billing.subtotal")}
                    value={
                      <PriceDisplay
                        value={billSummary.subtotal}
                        currency={currency}
                      />
                    }
                  />
                  <SummaryRow
                    label={t("billing.total")}
                    value={
                      <PriceDisplay
                        value={billSummary.totalAmount}
                        currency={currency}
                        emphasis
                      />
                    }
                    highlight
                  />
                  <SummaryRow
                    label={t("billing.change")}
                    value={
                      <PriceDisplay
                        value={Math.max(0, actualChangeAmount)}
                        currency={currency}
                        emphasis
                      />
                    }
                    highlight
                  />
                  {isCreditSale && amountDue > 0 && (
                    <SummaryRow
                      label={t("billing.amountDue")}
                      value={
                        <PriceDisplay
                          value={amountDue}
                          currency={currency}
                          emphasis
                        />
                      }
                      highlight
                    />
                  )}
                </div>

                {!hasValidTotal && draftItems.length > 0 && (
                  <Badge tone="danger">{t("billing.invalidTotal")}</Badge>
                )}

                {isCreditSale &&
                  !hasCreditCustomer &&
                  draftItems.length > 0 && (
                    <Badge tone="danger">
                      {t("billing.creditCustomerRequired")}
                    </Badge>
                  )}

                {isMixedSale && !isMixedSplitValid && draftItems.length > 0 && (
                  <Badge tone="danger">{t("billing.mixedSumMismatch")}</Badge>
                )}

                {hasValidTotal &&
                  !hasEnoughPayment &&
                  draftItems.length > 0 && (
                    <Badge tone="danger">{t("billing.paidBelowTotal")}</Badge>
                  )}

                <CheckoutActionBar
                  sticky={false}
                  className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1"
                >
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
                    variant="success"
                    size="lg"
                    disabled={!canFinalize}
                    className="flex-1"
                  >
                    {t("billing.reviewFinalize")}
                  </Button>
                </CheckoutActionBar>
              </form>
            </SectionCard>
          )}
        </div>
      </div>

      {draftItems.length > 0 && (
        <CheckoutActionBar className="fixed inset-x-0 bottom-0 lg:hidden">
          <div className="mx-auto flex max-w-screen-sm items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-500">
                {draftItems.length} {t("billing.items")}
              </p>
              <PriceDisplay
                value={billSummary.totalAmount}
                currency={currency}
                size="xl"
                emphasis
              />
            </div>
            <Button
              type="button"
              variant="success"
              size="lg"
              disabled={!canFinalize}
              onClick={form.handleSubmit(() => setConfirmOpen(true))}
              className="min-w-[132px]"
            >
              {t("billing.reviewFinalize")}
            </Button>
          </div>
        </CheckoutActionBar>
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
            <Button
              type="button"
              variant="success"
              onClick={form.handleSubmit(finalize)}
            >
              {t("billing.confirmSave")}
            </Button>
          </>
        }
      >
        <div className={panelTones.neutral + " rounded-xl border px-4 py-3"}>
          <SummaryRow
            label={t("billing.items")}
            value={String(draftItems.length)}
          />
          <SummaryRow
            label={t("billing.total")}
            value={
              <PriceDisplay
                value={billSummary.totalAmount}
                currency={currency}
                emphasis
              />
            }
            highlight
          />
          <SummaryRow
            label={t("billing.paid")}
            value={
              <PriceDisplay value={actualPaidAmount} currency={currency} />
            }
          />
          <SummaryRow
            label={t("billing.change")}
            value={
              <PriceDisplay
                value={Math.max(0, actualChangeAmount)}
                currency={currency}
                emphasis
              />
            }
            highlight
          />
          {isCreditSale && amountDue > 0 && (
            <SummaryRow
              label={t("billing.amountDue")}
              value={
                <PriceDisplay value={amountDue} currency={currency} emphasis />
              }
              highlight
            />
          )}
        </div>
      </Modal>

      <QuickProductModal
        open={quickAddOpen}
        barcode={missingBarcode}
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

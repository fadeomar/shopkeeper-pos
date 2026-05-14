"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { customerRepo, settingsRepo } from "@/lib/db/repositories";
import { normalizePhone } from "@/lib/utils/customer-key";
import { billFormSchema, type BillFormSchema } from "@/features/bills/schema";
import {
  calculateBillTotals,
  calculateChange,
  calculateLineSubtotal,
} from "@/lib/utils/calculations";
import { formatCurrency } from "@/lib/utils/money";
import { createFinalizedBill } from "@/lib/services/billing-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { BarcodeScannerModal } from "@/components/barcode/barcode-scanner-modal";
import { useLocale } from "@/components/providers/locale-context";
import { Card } from "@/components/ui/card";
import { QuickProductModal } from "./quick-product-modal";
import { ReceiptView } from "./receipt-view";
import { normalizeBarcode } from "@/lib/utils/barcode";
import type { Bill, BillDraftItem, BillItem, Customer, Product, Settings } from "@/types/domain";

const SUCCESS_AUTO_DISMISS_MS = 8000;

const POS_DRAFT_KEY = "shopkeeper-pos-bill-draft-v1";

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
    <Card className="flex flex-col gap-4" padding="sm">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-lg font-bold"
        >
          ✓
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-emerald-700">
            {t("billing.saleCompleted")}
          </p>
          <p className="font-mono text-base font-bold text-slate-900">
            {bill.billNumber}
          </p>
        </div>
      </div>

      <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
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
          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
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
    </Card>
  );
}

export function PosScreen() {
  const { t } = useLocale();
  const products = useLiveQuery(
    () => db.products.where("status").equals("active").sortBy("name"),
    [],
  );
  const customers = useLiveQuery(() => customerRepo.list(), []);
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const { push } = useToast();
  const currency = settings?.currency ?? "USD";

  const [draftItems, setDraftItems] = useState<BillDraftItem[]>([]);
  const [productId, setProductId] = useState("");
  const [barcodeQuery, setBarcodeQuery] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [missingBarcode, setMissingBarcode] = useState("");
  const [isPaidAmountManuallyEdited, setIsPaidAmountManuallyEdited] =
    useState(false);
  const [lastFinalized, setLastFinalized] = useState<
    { bill: Bill; items: BillItem[] } | null
  >(null);
  const [lastAdded, setLastAdded] = useState<{
    name: string;
    qty: number;
    subtotal: number;
  } | null>(null);
  const [customerFieldFocused, setCustomerFieldFocused] = useState(false);

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

  // Restore draft from localStorage
  useEffect(() => {
    const raw = window.localStorage.getItem(POS_DRAFT_KEY);
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
      window.localStorage.removeItem(POS_DRAFT_KEY);
    }
  }, [form]);

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
    window.localStorage.setItem(POS_DRAFT_KEY, payload);
  }, [
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
        ? Math.abs(watchedCashAmount + watchedCardAmount - billSummary.totalAmount)
        : 0,
    [isMixedSale, watchedCashAmount, watchedCardAmount, billSummary.totalAmount],
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
    const nameNeedle = watchedCustomerName?.trim().toLowerCase() ?? '';
    const phoneNeedle = normalizePhone(watchedCustomerPhone ?? '');
    if (!nameNeedle && !phoneNeedle) return [];
    const matches = customers.filter((customer) => {
      const nameMatches = nameNeedle && customer.name.toLowerCase().includes(nameNeedle);
      const phoneMatches = phoneNeedle && customer.normalizedPhone?.includes(phoneNeedle);
      return Boolean(nameMatches || phoneMatches);
    });
    // Hide the suggestion if the only match is already an exact one to avoid
    // showing a "you already picked this" row.
    if (matches.length === 1) {
      const m = matches[0];
      const exactName =
        m.name.toLowerCase() === nameNeedle && (phoneNeedle === '' || m.normalizedPhone === phoneNeedle);
      const exactPhone =
        m.normalizedPhone === phoneNeedle && (nameNeedle === '' || m.name.toLowerCase() === nameNeedle);
      if (exactName || exactPhone) return [];
    }
    return matches.slice(0, 5);
  }, [customers, customerFieldFocused, watchedCustomerName, watchedCustomerPhone]);

  function selectCustomer(customer: Customer) {
    form.setValue('customerName', customer.name, { shouldDirty: true });
    form.setValue('customerPhone', customer.phone ?? '', { shouldDirty: true });
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
    form.setValue("cashAmount", total, { shouldDirty: false, shouldValidate: false });
    form.setValue("cardAmount", 0, { shouldDirty: false, shouldValidate: false });
    // Intentionally only depend on isMixedSale + total — moving the split
    // around afterwards is the cashier's job, not auto-correction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMixedSale, billSummary.totalAmount, form]);

  // Auto-dismiss the success panel after a short window so the right column
  // returns to the bill summary form. Cancelled if the cashier starts a new
  // sale (appendProduct) or explicitly dismisses via the panel's buttons.
  useEffect(() => {
    if (!lastFinalized) return;
    const id = window.setTimeout(() => setLastFinalized(null), SUCCESS_AUTO_DISMISS_MS);
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
  }, [confirmOpen, scannerOpen, quickAddOpen, lastFinalized, canFinalize, form]);

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
    setDraftItems((cur) =>
      cur.map((i) => {
        if (i.productId !== productId) return i;
        return {
          ...i,
          quantity: Math.max(1, Math.min(quantity, i.availableStock)),
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
    window.localStorage.removeItem(POS_DRAFT_KEY);
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
        form: { ...values, paidAmount: actualPaidAmount, cashAmount: watchedCashAmount, cardAmount: watchedCardAmount },
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
    return (
      <Card>
        <p className="text-sm text-slate-500">{t("billing.loadingPos")}</p>
      </Card>
    );
  }

  return (
    <>
      {/* Mobile-first layout, desktop keeps two columns */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-4 xl:gap-5 items-start">
        {/* ── Build bill panel ─────────────────────────────────────────── */}
        <Card className="flex flex-col gap-4" padding="sm">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-800">
              {t("billing.buildBill")}
            </h3>
            {draftItems.length > 0 && (
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                {draftItems.length} {t("billing.items")}
              </span>
            )}
          </div>

          {lastAdded && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
            >
              <span aria-hidden className="text-emerald-600">
                ✓
              </span>
              <span className="font-medium truncate">{lastAdded.name}</span>
              <span className="ml-auto shrink-0 text-xs font-semibold tabular-nums text-emerald-700">
                ×{lastAdded.qty} · {formatCurrency(lastAdded.subtotal, currency)}
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
            <button
              type="button"
              title={`${t("billing.shortcutsHelp")}\n• ${t("billing.shortcutFinalize")}\n• ${t("billing.shortcutClearBarcode")}`}
              aria-label={t("billing.shortcutsHelp")}
              className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
            >
              ?
            </button>
          </div>

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
                      <div className="rounded-xl bg-slate-50 p-2">
                        <p className="text-slate-500">{t("billing.stock")}</p>
                        <p className="font-bold text-slate-800 tabular-nums">
                          {item.availableStock}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-2">
                        <p className="text-slate-500">{t("billing.sell")}</p>
                        <p className="font-bold text-slate-800 tabular-nums">
                          {formatCurrency(item.unitSellPrice, currency)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-2">
                        <p className="text-slate-500">
                          {t("billing.subtotalCol")}
                        </p>
                        <p className="font-bold text-slate-800 tabular-nums">
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
                      <Input
                        type="number"
                        min={1}
                        max={item.availableStock}
                        value={item.quantity}
                        onChange={(e) =>
                          updateQuantity(item.productId, Number(e.target.value))
                        }
                        className="w-28 text-center"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-100">
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
                          {item.availableStock}
                        </td>
                        <td className="px-3 py-2.5">
                          <Input
                            type="number"
                            min={1}
                            max={item.availableStock}
                            value={item.quantity}
                            onChange={(e) =>
                              updateQuantity(
                                item.productId,
                                Number(e.target.value),
                              )
                            }
                            className="w-20 text-center"
                          />
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-700">
                          {formatCurrency(item.unitSellPrice, currency)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums font-medium text-slate-800">
                          {formatCurrency(
                            calculateLineSubtotal(
                              item.quantity,
                              item.unitSellPrice,
                            ),
                            currency,
                          )}
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
              <div className="relative flex flex-col gap-3">
                <FormField label={t("billing.customerName")}>
                  <Input
                    {...form.register("customerName")}
                    onFocus={() => setCustomerFieldFocused(true)}
                    onBlur={() => {
                      // Delay so a click on a suggestion can still register.
                      window.setTimeout(() => setCustomerFieldFocused(false), 120);
                    }}
                  />
                </FormField>
                <FormField label={t("billing.customerPhone")}>
                  <Input
                    {...form.register("customerPhone")}
                    onFocus={() => setCustomerFieldFocused(true)}
                    onBlur={() => {
                      window.setTimeout(() => setCustomerFieldFocused(false), 120);
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
                          <p className="text-sm font-medium text-slate-800 truncate">{customer.name}</p>
                          {customer.phone && (
                            <p className="text-xs text-slate-500 font-mono truncate">{customer.phone}</p>
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
                    step="0.01"
                    {...form.register("discountAmount", {
                      valueAsNumber: true,
                    })}
                  />
                </FormField>
                <FormField label={t("billing.tax")}>
                  <Input
                    type="number"
                    step="0.01"
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
                        step="0.01"
                        value={watchedCashAmount}
                        onChange={(e) => {
                          const v =
                            e.target.value === "" ? 0 : Number(e.target.value);
                          const safe = Number.isFinite(v) ? Math.max(0, v) : 0;
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
                        step="0.01"
                        value={watchedCardAmount}
                        onChange={(e) => {
                          const v =
                            e.target.value === "" ? 0 : Number(e.target.value);
                          const safe = Number.isFinite(v) ? Math.max(0, v) : 0;
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
                        step="0.01"
                        value={
                          Number.isFinite(actualPaidAmount)
                            ? actualPaidAmount
                            : 0
                        }
                        onChange={(e) => {
                          setIsPaidAmountManuallyEdited(true);
                          const v =
                            e.target.value === "" ? 0 : Number(e.target.value);
                          form.setValue("paidAmount", Number.isFinite(v) ? v : 0, {
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
                        <button
                          type="button"
                          onClick={() => setIsPaidAmountManuallyEdited(false)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                        >
                          {t("billing.exact")}
                        </button>
                        {[5, 10, 20, 50, 100].map((denomination) => (
                          <button
                            key={denomination}
                            type="button"
                            onClick={() => {
                              setIsPaidAmountManuallyEdited(true);
                              form.setValue("paidAmount", denomination, {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                            }}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 tabular-nums hover:bg-slate-50 hover:border-slate-300 transition-colors"
                          >
                            {denomination}
                          </button>
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
                <p className="text-xs text-red-600 font-medium">
                  {t("billing.invalidTotal")}
                </p>
              )}

              {isCreditSale && !hasCreditCustomer && draftItems.length > 0 && (
                <p className="text-xs text-red-600 font-medium">
                  {t("billing.creditCustomerRequired")}
                </p>
              )}

              {isMixedSale && !isMixedSplitValid && draftItems.length > 0 && (
                <p className="text-xs text-red-600 font-medium">
                  {t("billing.mixedSumMismatch")}
                </p>
              )}

              {hasValidTotal && !hasEnoughPayment && draftItems.length > 0 && (
                <p className="text-xs text-red-600 font-medium">
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
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-3 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-screen-sm items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-500">
                {draftItems.length} {t("billing.items")}
              </p>
              <p className="truncate text-lg font-black text-slate-900 tabular-nums">
                {formatCurrency(billSummary.totalAmount, currency)}
              </p>
            </div>
            <Button
              type="button"
              disabled={!canFinalize}
              onClick={form.handleSubmit(() => setConfirmOpen(true))}
              className="min-w-[132px]"
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

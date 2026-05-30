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
import {
  customerRepo,
  settingsRepo,
  supplierRepo,
} from "@/lib/db/repositories";
import { normalizePhone } from "@/lib/utils/customer-key";
import {
  purchaseFormSchema,
  type PurchaseFormSchema,
} from "@/features/purchases/schema";
import {
  calculateBillTotals,
  calculateChange,
  calculateLineSubtotal,
} from "@/lib/utils/calculations";
import { MONEY_EPSILON, formatCurrency } from "@/lib/utils/money";
import { blurInputOnEnter } from "@/lib/utils/dismiss-on-enter";
import { createFinalizedPurchase } from "@/lib/services/purchase-service";
import { useAuth } from "@/components/providers/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput, MoneyInputRHF } from "@/components/ui/money-input";
import { QuantityStepper } from "@/components/pos/quantity-stepper";
import { PaymentMethodControl } from "@/components/pos/payment-method-control";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CircleCheck, Search, Store, X } from "lucide-react";
import { DataTable, useDataTableLabels } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { BarcodeScannerModal } from "@/components/barcode/barcode-scanner-modal";
import { normalizeBarcode } from "@/lib/utils/barcode";
import { useLocale } from "@/components/providers/locale-context";
import { Card } from "@/components/ui/card";
import type {
  Purchase,
  PurchaseDraftItem,
  PurchaseItem,
  Settings,
  Supplier,
} from "@/types/domain";

// Avoid unused import warning — customerRepo is re-exported by the repos
// barrel but not used here.
void customerRepo;

const PURCHASE_DRAFT_KEY_PREFIX = "shopkeeper-purchase-draft-v1";

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

function dismissKeyboardOnEnter(event: React.KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") {
    event.preventDefault();
    event.currentTarget.blur();
  }
}

function SuccessPanel({
  purchase,
  items,
  settings,
  currency,
  onDismiss,
}: {
  purchase: Purchase;
  items: PurchaseItem[];
  settings?: Settings;
  currency: string;
  onDismiss: () => void;
}) {
  const { t } = useLocale();
  const newRef = useRef<HTMLButtonElement | null>(null);
  const amountDue = Math.max(0, purchase.totalAmount - purchase.paidAmount);

  useEffect(() => {
    newRef.current?.focus({ preventScroll: true });
  }, []);

  // Avoid unused import warnings — these are used in future detail pages.
  void items;
  void settings;

  return (
    <Card className="flex flex-col gap-4" padding="sm">
      <div className="flex items-start gap-3">
        <CircleCheck
          aria-hidden
          size={36}
          strokeWidth={2}
          className="shrink-0 text-success"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-success">
            {t("purchases.purchaseCompleted")}
          </p>
          <p className="font-mono text-base font-bold text-slate-900">
            {purchase.purchaseNumber}
          </p>
        </div>
      </div>

      <div className="rounded-xl bg-success-soft border border-success/20 px-4 py-3">
        <SummaryRow
          label={t("purchases.total")}
          value={formatCurrency(purchase.totalAmount, currency)}
          highlight
        />
        <SummaryRow
          label={t("purchases.paid")}
          value={formatCurrency(purchase.paidAmount, currency)}
        />
        {amountDue > 0 && (
          <SummaryRow
            label={t("purchases.amountDue")}
            value={formatCurrency(amountDue, currency)}
            highlight
          />
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Link
          href={"/purchases" as never}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {t("purchases.historyTitle")}
        </Link>
        <Button
          ref={newRef}
          type="button"
          onClick={onDismiss}
          className="w-full"
        >
          {t("purchases.newPurchaseAction")}
        </Button>
      </div>
    </Card>
  );
}

export function PurchaseEntryScreen() {
  const { t } = useLocale();
  const tableLabels = useDataTableLabels();
  const { user } = useAuth();
  const products = useLiveQuery(
    () => db.products.where("status").equals("active").sortBy("name"),
    [],
  );
  const suppliers = useLiveQuery(() => supplierRepo.list(), []);
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const { push } = useToast();
  const currency = settings?.currency ?? "ILS";
  const draftKey = user?.uid
    ? `${PURCHASE_DRAFT_KEY_PREFIX}:${user.uid}`
    : null;

  const [draftItems, setDraftItems] = useState<PurchaseDraftItem[]>([]);
  const [productId, setProductId] = useState("");
  const [newLineCost, setNewLineCost] = useState<number>(0);
  const [newLineQty, setNewLineQty] = useState<number>(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [isPaidAmountManuallyEdited, setIsPaidAmountManuallyEdited] =
    useState(false);
  const [lastFinalized, setLastFinalized] = useState<{
    purchase: Purchase;
    items: PurchaseItem[];
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
            {formatCurrency(product.buyPrice, currency)} ·{" "}
            {product.quantityInStock}
          </span>
        ),
      })),
    [products, currency],
  );

  const [supplierSheetOpen, setSupplierSheetOpen] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");

  const form = useForm<PurchaseFormSchema>({
    resolver: zodResolver(purchaseFormSchema),
    defaultValues: {
      cashierName: settings?.cashierName ?? t("common.owner"),
      supplierName: "",
      supplierPhone: "",
      paymentMethod: "cash",
      discountAmount: 0,
      taxAmount: 0,
      paidAmount: 0,
      cashAmount: 0,
      cardAmount: 0,
      notes: "",
    },
  });

  // Restore draft from per-user localStorage.
  useEffect(() => {
    if (!draftKey) return;
    const raw = window.localStorage.getItem(draftKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        items: PurchaseDraftItem[];
        form: PurchaseFormSchema;
      };
      const items = parsed.items ?? [];
      setDraftItems(items);
      form.reset(parsed.form);
      // Reconstruct the manual-edit flag from the saved draft. The auto-fill
      // default is the purchase total (or 0 for a credit purchase). If the
      // saved paidAmount differs from that default, the cashier typed it by
      // hand — flag it as manual so the auto-fill effect below doesn't
      // clobber it on reload. Without this, the flag stays false and the
      // cashier's entered amount is overwritten by the total.
      const autoTotal = calculateBillTotals(
        items.map((i) => ({
          quantity: i.quantity,
          unitBuyPrice: i.unitCost,
          unitSellPrice: i.unitCost,
        })),
        parsed.form.discountAmount,
        parsed.form.taxAmount,
      ).totalAmount;
      const expectedDefault =
        parsed.form.paymentMethod === "credit" ? 0 : autoTotal;
      setIsPaidAmountManuallyEdited(
        Math.abs((parsed.form.paidAmount ?? 0) - expectedDefault) > 0.001,
      );
    } catch {
      window.localStorage.removeItem(draftKey);
    }
  }, [draftKey, form]);

  const watchedSupplierName = form.watch("supplierName");
  const watchedSupplierPhone = form.watch("supplierPhone");
  const watchedPaymentMethod = form.watch("paymentMethod");
  const watchedDiscountAmount = Number(form.watch("discountAmount") || 0);
  const watchedTaxAmount = Number(form.watch("taxAmount") || 0);
  const watchedPaidAmount = Number(form.watch("paidAmount") || 0);
  const watchedCashAmount = Number(form.watch("cashAmount") || 0);
  const watchedCardAmount = Number(form.watch("cardAmount") || 0);

  // Persist draft to localStorage.
  useEffect(() => {
    if (!draftKey) return;
    window.localStorage.setItem(
      draftKey,
      JSON.stringify({ items: draftItems, form: form.getValues() }),
    );
  }, [
    draftKey,
    draftItems,
    watchedSupplierName,
    watchedSupplierPhone,
    watchedPaymentMethod,
    watchedDiscountAmount,
    watchedTaxAmount,
    watchedPaidAmount,
    watchedCashAmount,
    watchedCardAmount,
    form,
  ]);

  const purchaseSummary = useMemo(
    () =>
      calculateBillTotals(
        draftItems.map((i) => ({
          quantity: i.quantity,
          unitBuyPrice: i.unitCost,
          unitSellPrice: i.unitCost,
        })),
        watchedDiscountAmount,
        watchedTaxAmount,
      ),
    [draftItems, watchedDiscountAmount, watchedTaxAmount],
  );

  const isCreditPurchase = watchedPaymentMethod === "credit";
  const isMixedPurchase = watchedPaymentMethod === "mixed";
  const defaultPaidAmount = isCreditPurchase
    ? 0
    : Number(purchaseSummary.totalAmount.toFixed(2));
  const actualPaidAmount = isPaidAmountManuallyEdited
    ? watchedPaidAmount
    : defaultPaidAmount;
  const actualChangeAmount = calculateChange(
    actualPaidAmount,
    purchaseSummary.totalAmount,
  );
  const amountDue = Math.max(
    0,
    calculateChange(purchaseSummary.totalAmount, actualPaidAmount),
  );
  const mixedSumDelta = useMemo(
    () =>
      isMixedPurchase
        ? Math.abs(
            watchedCashAmount + watchedCardAmount - purchaseSummary.totalAmount,
          )
        : 0,
    [
      isMixedPurchase,
      watchedCashAmount,
      watchedCardAmount,
      purchaseSummary.totalAmount,
    ],
  );
  const isMixedSplitValid = !isMixedPurchase || mixedSumDelta < MONEY_EPSILON;
  const hasCreditSupplier = Boolean(
    watchedSupplierName?.trim() || watchedSupplierPhone?.trim(),
  );

  // ── Settings-driven enforcement (payment methods + tax mode) ──────────────
  // Purchases share the store's payment-method toggles. requireShift and the
  // discount limit are sell-side concerns and intentionally not applied here.
  const enableCash = settings?.enableCash !== false;
  const enableCard = settings?.enableCard !== false;
  const enableCredit = settings?.enableCredit !== false;
  const availablePaymentMethods = useMemo<
    PurchaseFormSchema["paymentMethod"][]
  >(() => {
    const methods: PurchaseFormSchema["paymentMethod"][] = [];
    if (enableCash) methods.push("cash");
    if (enableCard) methods.push("card");
    if (enableCredit) methods.push("credit");
    return methods.length ? methods : ["cash"];
  }, [enableCash, enableCard, enableCredit]);

  useEffect(() => {
    if (
      !availablePaymentMethods.includes(
        watchedPaymentMethod as PurchaseFormSchema["paymentMethod"],
      )
    ) {
      form.setValue("paymentMethod", availablePaymentMethods[0], {
        shouldDirty: false,
      });
    }
  }, [availablePaymentMethods, watchedPaymentMethod, form]);

  // Only "exclusive" shows a manual tax field (added on top). "none"/"inclusive"
  // hide it and force 0 — matches billing and avoids double-counting inclusive.
  const taxEnabled = settings?.taxMode === "exclusive";
  useEffect(() => {
    if (!taxEnabled && watchedTaxAmount !== 0) {
      form.setValue("taxAmount", 0, {
        shouldDirty: false,
        shouldValidate: true,
      });
    }
  }, [taxEnabled, watchedTaxAmount, form]);

  const hasValidTotal = purchaseSummary.totalAmount >= 0;
  const hasEnoughPayment =
    isCreditPurchase || isMixedPurchase || actualChangeAmount >= 0;
  const canFinalize =
    draftItems.length > 0 &&
    hasValidTotal &&
    hasEnoughPayment &&
    isMixedSplitValid &&
    (!isCreditPurchase || hasCreditSupplier);

  // Auto-fill paid amount on total change (unless cashier manually overrode).
  useEffect(() => {
    if (isPaidAmountManuallyEdited) return;
    form.setValue("paidAmount", defaultPaidAmount, {
      shouldDirty: false,
      shouldValidate: true,
    });
  }, [defaultPaidAmount, isPaidAmountManuallyEdited, form]);

  // Initialize mixed split to cash=total/card=0 when switching to mixed.
  useEffect(() => {
    if (!isMixedPurchase) return;
    const total = Number(purchaseSummary.totalAmount.toFixed(2));
    if (Math.abs(watchedCashAmount + watchedCardAmount - total) < MONEY_EPSILON)
      return;
    form.setValue("cashAmount", total, { shouldDirty: false });
    form.setValue("cardAmount", 0, { shouldDirty: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMixedPurchase, purchaseSummary.totalAmount, form]);

  // Auto-dismiss success panel like POS.
  useEffect(() => {
    if (!lastFinalized) return;
    const id = window.setTimeout(() => setLastFinalized(null), 8000);
    return () => window.clearTimeout(id);
  }, [lastFinalized]);

  function selectSupplier(supplier: Supplier) {
    form.setValue("supplierName", supplier.name, { shouldDirty: true });
    form.setValue("supplierPhone", supplier.phone ?? "", { shouldDirty: true });
  }

  function addLine() {
    const product = products?.find((p) => p.id === productId);
    if (!product) return;
    const qty = Math.max(1, Math.trunc(newLineQty || 0));
    const cost = Math.max(0, newLineCost || product.buyPrice);
    setDraftItems((cur) => {
      const existing = cur.find((i) => i.productId === product.id);
      if (existing) {
        return cur.map((i) =>
          i.productId === product.id
            ? { ...i, quantity: i.quantity + qty, unitCost: cost }
            : i,
        );
      }
      return [
        ...cur,
        {
          productId: product.id,
          barcode: product.barcode,
          name: product.name,
          category: product.category,
          currentStock: product.quantityInStock,
          quantity: qty,
          unitCost: cost,
          unitSellPriceBefore: product.sellPrice,
        },
      ];
    });
    setProductId("");
    setNewLineCost(0);
    setNewLineQty(1);
    if (lastFinalized) setLastFinalized(null);
  }

  function handleScanForPurchase(barcode: string) {
    const bc = normalizeBarcode(barcode);
    const product = products?.find((p) => normalizeBarcode(p.barcode) === bc);
    if (!product) {
      push(t("billing.productNotFound", { barcode: bc }), "error");
      return;
    }
    setDraftItems((cur) => {
      const existing = cur.find((i) => i.productId === product.id);
      if (existing) {
        return cur.map((i) =>
          i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i,
        );
      }
      return [
        ...cur,
        {
          productId: product.id,
          barcode: product.barcode,
          name: product.name,
          category: product.category,
          currentStock: product.quantityInStock,
          quantity: 1,
          unitCost: product.buyPrice,
          unitSellPriceBefore: product.sellPrice,
        },
      ];
    });
    if (lastFinalized) setLastFinalized(null);
  }

  function updateLine(
    productIdToUpdate: string,
    patch: Partial<PurchaseDraftItem>,
  ) {
    setDraftItems((cur) =>
      cur.map((i) => {
        if (i.productId !== productIdToUpdate) return i;
        const next = { ...i, ...patch };
        next.quantity = Number.isFinite(next.quantity)
          ? Math.max(1, Math.trunc(next.quantity))
          : 1;
        next.unitCost = Number.isFinite(next.unitCost)
          ? Math.max(0, next.unitCost)
          : 0;
        return next;
      }),
    );
  }

  function removeLine(productIdToRemove: string) {
    setDraftItems((cur) =>
      cur.filter((i) => i.productId !== productIdToRemove),
    );
  }

  function clearDraft() {
    setDraftItems([]);
    setIsPaidAmountManuallyEdited(false);
    form.reset({
      cashierName: settings?.cashierName ?? t("common.owner"),
      supplierName: "",
      supplierPhone: "",
      paymentMethod: "cash",
      discountAmount: 0,
      taxAmount: 0,
      paidAmount: 0,
      cashAmount: 0,
      cardAmount: 0,
      notes: "",
    });
    if (draftKey) window.localStorage.removeItem(draftKey);
  }

  async function finalize(values: PurchaseFormSchema) {
    if (draftItems.length === 0) {
      push(t("purchases.addOneProduct"), "error");
      return;
    }
    try {
      const { purchase, purchaseItems } = await createFinalizedPurchase({
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
      setLastFinalized({ purchase, items: purchaseItems });
    } catch (error) {
      push(
        getServiceErrorMessage(error, t, t("purchases.purchaseFailed")),
        "error",
      );
    }
  }

  const draftItemColumns: ColumnDef<PurchaseDraftItem, unknown>[] = [
    {
      accessorKey: "name",
      header: t("purchases.item"),
      cell: ({ row }) => (
        <span className="font-medium text-slate-800">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "currentStock",
      header: t("purchases.currentStock"),
      cell: ({ row }) => (
        <span className="tabular-nums text-slate-500">
          {row.original.currentStock}
        </span>
      ),
    },
    {
      accessorKey: "quantity",
      header: t("purchases.qty"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <QuantityStepper
            value={item.quantity}
            onChange={(v) => updateLine(item.productId, { quantity: v })}
            min={1}
            className="w-[140px]"
          />
        );
      },
    },
    {
      accessorKey: "unitCost",
      header: t("purchases.cost"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <MoneyInput
            value={item.unitCost}
            onValueChange={(v) => updateLine(item.productId, { unitCost: v })}
            currency={currency}
            min={0}
            onKeyDown={dismissKeyboardOnEnter}
            inputSize="sm"
            className="w-36"
            fullWidth={false}
          />
        );
      },
    },
    {
      id: "subtotal",
      header: t("purchases.subtotal"),
      accessorFn: (row) => calculateLineSubtotal(row.quantity, row.unitCost),
      cell: ({ row }) => (
        <span className="font-medium tabular-nums text-slate-800">
          {formatCurrency(
            calculateLineSubtotal(row.original.quantity, row.original.unitCost),
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
          onClick={() => removeLine(row.original.productId)}
          aria-label={t("common.remove")}
        >
          <X size={14} aria-hidden />
        </Button>
      ),
    },
  ];

  if (!products) {
    return (
      <Card>
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      </Card>
    );
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">
          {t("purchases.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-500 max-w-2xl">
          {t("purchases.subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-4 xl:gap-5 items-start">
        {/* Build purchase panel */}
        <Card className="flex flex-col gap-4" padding="sm">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-800">
              {t("purchases.title")}
            </h3>
            {draftItems.length > 0 && (
              <span className="rounded-full bg-info-soft px-3 py-1 text-xs font-semibold text-info">
                {draftItems.length} {t("purchases.items")}
              </span>
            )}
          </div>

          {/* Product + qty + cost entry */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto_auto] gap-2">
            <SearchableSelect
              value={productId}
              onValueChange={(value) => setProductId(value ?? "")}
              options={productOptions}
              placeholder={t("purchases.selectProduct")}
              searchPlaceholder={t("products.searchPlaceholder")}
              emptyMessage={t("products.noProducts")}
              disabled={!products?.length}
            />
            <QuantityStepper
              value={newLineQty}
              onChange={setNewLineQty}
              min={1}
              className="w-[140px]"
            />
            <MoneyInput
              value={newLineCost}
              onValueChange={setNewLineCost}
              currency={currency}
              min={0}
              onKeyDown={dismissKeyboardOnEnter}
              placeholder={t("purchases.unitCost")}
              inputSize="sm"
              className="w-32"
              fullWidth={false}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={addLine}
              disabled={!productId}
            >
              {t("purchases.addItem")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setScannerOpen(true)}
            >
              {t("common.scan")}
            </Button>
          </div>

          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <p>{t("purchases.productMissingNote")}</p>
            <Link
              href="/products"
              className="mt-2 inline-flex text-sm font-semibold text-info hover:text-info/80"
            >
              {t("purchases.addProductInProducts")}
            </Link>
          </div>

          {/* Items list */}
          {draftItems.length === 0 ? (
            <EmptyState
              title={t("purchases.addOneProduct")}
              description={t("purchases.subtitle")}
            />
          ) : (
            <>
              {/* Mobile touch-card layout — fully editable qty + cost */}
              <div className="flex flex-col gap-2 md:hidden">
                {draftItems.map((item) => (
                  <div
                    key={item.productId}
                    className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs"
                  >
                    {/* Header: name + remove */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {item.name}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {t("purchases.currentStock")}: {item.currentStock}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(item.productId)}
                        aria-label={t("common.remove")}
                        className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-danger-soft hover:text-danger transition-colors"
                      >
                        <X size={16} aria-hidden />
                      </button>
                    </div>

                    {/* Editable qty + cost row */}
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
                          {t("purchases.qty")}
                        </span>
                        <QuantityStepper
                          value={item.quantity}
                          onChange={(v) =>
                            updateLine(item.productId, { quantity: v })
                          }
                          min={1}
                          className="w-full"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
                          {t("purchases.cost")}
                        </span>
                        <MoneyInput
                          value={item.unitCost}
                          onValueChange={(v) =>
                            updateLine(item.productId, { unitCost: v })
                          }
                          currency={currency}
                          min={0}
                          onKeyDown={dismissKeyboardOnEnter}
                          inputSize="sm"
                          fullWidth
                        />
                      </label>
                    </div>

                    {/* Subtotal row */}
                    <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                      <span className="text-xs text-slate-500">
                        {t("purchases.subtotal")}
                      </span>
                      <span
                        className="text-sm font-bold tabular-nums text-slate-900"
                        dir="ltr"
                      >
                        {formatCurrency(
                          calculateLineSubtotal(item.quantity, item.unitCost),
                          currency,
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop table */}
              <div className="hidden md:block">
                <DataTable
                  columns={draftItemColumns}
                  data={draftItems}
                  enableGlobalSearch={false}
                  emptyTitle={t("purchases.addOneProduct")}
                  pageSize={10}
                  labels={tableLabels}
                />
              </div>
            </>
          )}
        </Card>

        {/* Summary panel */}
        <div className="xl:sticky xl:top-6">
          {lastFinalized ? (
            <SuccessPanel
              purchase={lastFinalized.purchase}
              items={lastFinalized.items}
              settings={settings}
              currency={currency}
              onDismiss={() => setLastFinalized(null)}
            />
          ) : (
            <Card className="flex flex-col gap-4" padding="sm">
              <h3 className="text-base font-semibold text-slate-800">
                {t("purchases.finalizePurchase")}
              </h3>

              <form
                className="flex flex-col gap-3"
                onSubmit={form.handleSubmit(() => setConfirmOpen(true))}
              >
                {/* Supplier — compact selector; the select sheet opens on tap */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                    {t("purchases.supplierName")}
                  </span>
                  {watchedSupplierName || watchedSupplierPhone ? (
                    /* Selected supplier chip */
                    <div className="flex items-center gap-2 rounded-xl border border-border-default bg-surface px-3 py-2">
                      <Store
                        size={15}
                        aria-hidden
                        className="shrink-0 text-slate-400"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {watchedSupplierName || "—"}
                        </p>
                        {watchedSupplierPhone && (
                          <p className="text-xs text-slate-500 font-mono truncate">
                            {watchedSupplierPhone}
                          </p>
                        )}
                      </div>
                      {/* Change — reopens the sheet */}
                      <button
                        type="button"
                        onClick={() => setSupplierSheetOpen(true)}
                        aria-label={t("purchases.pickSupplier")}
                        className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-surface-soft hover:text-slate-600 transition-colors"
                      >
                        <Search size={14} aria-hidden />
                      </button>
                      {/* Clear */}
                      <button
                        type="button"
                        onClick={() => {
                          form.setValue("supplierName", "", {
                            shouldDirty: true,
                          });
                          form.setValue("supplierPhone", "", {
                            shouldDirty: true,
                          });
                        }}
                        aria-label={t("purchases.clearSupplier")}
                        className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-danger-soft hover:text-danger transition-colors"
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </div>
                  ) : (
                    /* Empty state — "Select supplier" button */
                    <button
                      type="button"
                      onClick={() => setSupplierSheetOpen(true)}
                      className={clsx(
                        "flex items-center gap-2 w-full rounded-xl border border-dashed border-border-default",
                        "bg-surface px-3 py-2.5 text-sm text-slate-500",
                        "hover:border-border-strong hover:bg-surface-soft hover:text-slate-700 transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                      )}
                    >
                      <Store size={15} aria-hidden className="shrink-0" />
                      <span>{t("purchases.pickSupplier")}</span>
                    </button>
                  )}
                </div>

                <FormField label={t("purchases.paymentMethod")}>
                  <PaymentMethodControl
                    value={watchedPaymentMethod as PurchaseFormSchema["paymentMethod"]}
                    onChange={(v) =>
                      form.setValue("paymentMethod", v, { shouldDirty: true })
                    }
                    label={t("purchases.paymentMethod")}
                    available={availablePaymentMethods}
                  />
                </FormField>

                <div className="grid grid-cols-2 gap-3">
                  <FormField label={t("purchases.discount")}>
                    <MoneyInputRHF
                      name="discountAmount"
                      control={form.control}
                      currency={currency}
                      min={0}
                      onKeyDown={dismissKeyboardOnEnter}
                    />
                  </FormField>
                  {taxEnabled && (
                    <FormField label={t("purchases.tax")}>
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

                {isMixedPurchase ? (
                  <FormField label={t("purchases.mixedSplit")}>
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
                            form.setValue(
                              "cardAmount",
                              Math.max(0, purchaseSummary.totalAmount - safe),
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
                            form.setValue(
                              "cashAmount",
                              Math.max(0, purchaseSummary.totalAmount - safe),
                              { shouldDirty: true, shouldValidate: false },
                            );
                          }}
                        />
                      </label>
                    </div>
                  </FormField>
                ) : watchedPaymentMethod === "card" ? null : (
                  <FormField label={t("purchases.actualPaid")}>
                    <div className="flex gap-2">
                      <MoneyInput
                        value={
                          Number.isFinite(actualPaidAmount)
                            ? actualPaidAmount
                            : 0
                        }
                        currency={currency}
                        min={0}
                        onValueChange={(v) => {
                          setIsPaidAmountManuallyEdited(true);
                          form.setValue("paidAmount", v, {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                        }}
                        onKeyDown={dismissKeyboardOnEnter}
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
                  </FormField>
                )}

                <FormField label={t("purchases.notes")}>
                  <Input {...form.register("notes")} />
                </FormField>

                <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
                  <SummaryRow
                    label={t("purchases.subtotal")}
                    value={formatCurrency(purchaseSummary.subtotal, currency)}
                  />
                  <SummaryRow
                    label={t("purchases.total")}
                    value={formatCurrency(
                      purchaseSummary.totalAmount,
                      currency,
                    )}
                    highlight
                  />
                  <SummaryRow
                    label={t("purchases.change")}
                    value={formatCurrency(
                      Math.max(0, actualChangeAmount),
                      currency,
                    )}
                  />
                  {isCreditPurchase && amountDue > 0 && (
                    <SummaryRow
                      label={t("purchases.amountDue")}
                      value={formatCurrency(amountDue, currency)}
                      highlight
                    />
                  )}
                </div>

                {!hasValidTotal && draftItems.length > 0 && (
                  <p className="text-xs text-danger font-medium">
                    {t("purchases.invalidTotal")}
                  </p>
                )}
                {isCreditPurchase &&
                  !hasCreditSupplier &&
                  draftItems.length > 0 && (
                    <p className="text-xs text-danger font-medium">
                      {t("purchases.creditSupplierRequired")}
                    </p>
                  )}
                {isMixedPurchase &&
                  !isMixedSplitValid &&
                  draftItems.length > 0 && (
                    <p className="text-xs text-danger font-medium">
                      {t("purchases.mixedSumMismatch")}
                    </p>
                  )}
                {hasValidTotal &&
                  !hasEnoughPayment &&
                  draftItems.length > 0 && (
                    <p className="text-xs text-danger font-medium">
                      {t("purchases.paidBelowTotal")}
                    </p>
                  )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={clearDraft}
                    className="flex-1"
                  >
                    {t("purchases.clearDraft")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={!canFinalize}
                    className="flex-1"
                  >
                    {t("purchases.reviewFinalize")}
                  </Button>
                </div>
              </form>
            </Card>
          )}
        </div>
      </div>

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleScanForPurchase}
        continuous
      />

      <Modal
        open={confirmOpen}
        title={t("purchases.finalizePurchase")}
        description={t("purchases.finalizeDesc")}
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
              {t("purchases.confirmSave")}
            </Button>
          </>
        }
      >
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <SummaryRow
            label={t("purchases.items")}
            value={String(draftItems.length)}
          />
          <SummaryRow
            label={t("purchases.total")}
            value={formatCurrency(purchaseSummary.totalAmount, currency)}
            highlight
          />
          <SummaryRow
            label={t("purchases.paid")}
            value={formatCurrency(actualPaidAmount, currency)}
          />
          {amountDue > 0 && (
            <SummaryRow
              label={t("purchases.amountDue")}
              value={formatCurrency(amountDue, currency)}
              highlight
            />
          )}
        </div>
      </Modal>

      {/* ── Supplier select sheet ────────────────────────────────────────── */}
      <Modal
        open={supplierSheetOpen}
        title={t("purchases.pickSupplier")}
        onClose={() => {
          setSupplierSheetOpen(false);
          setSupplierSearch("");
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
              value={supplierSearch}
              onChange={(e) => setSupplierSearch(e.target.value)}
              placeholder={t("purchases.searchSuppliers")}
              aria-label={t("purchases.searchSuppliers")}
              className={clsx(
                "w-full rounded-xl border border-border-default bg-surface py-2 ps-9 pe-3",
                "text-sm text-slate-800 placeholder:text-slate-400",
                "focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-border-strong",
                "[font-size:16px]", // prevents mobile zoom
              )}
            />
          </div>

          {/* Supplier list */}
          {(() => {
            const needle = supplierSearch.trim().toLowerCase();
            const filtered = (suppliers ?? [])
              .filter(
                (s) =>
                  !needle ||
                  s.name.toLowerCase().includes(needle) ||
                  s.normalizedPhone?.includes(normalizePhone(supplierSearch)),
              )
              .slice(0, 20);

            if (filtered.length === 0) {
              return (
                <p className="py-4 text-center text-sm text-slate-500">
                  {t("purchases.noSuppliersFound")}
                </p>
              );
            }

            return (
              <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-border-default">
                {filtered.map((supplier) => (
                  <li key={supplier.id}>
                    <button
                      type="button"
                      onClick={() => {
                        selectSupplier(supplier);
                        setSupplierSheetOpen(false);
                        setSupplierSearch("");
                      }}
                      className="w-full text-start px-3 py-2.5 hover:bg-surface-soft transition-colors"
                    >
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {supplier.name}
                      </p>
                      {supplier.phone && (
                        <p className="text-xs text-slate-500 font-mono">
                          {supplier.phone}
                        </p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            );
          })()}

          {/* Manual entry — for suppliers not yet in the database */}
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-info hover:text-info/80 transition-colors list-none">
              <span className="rotate-0 transition-transform group-open:rotate-90">
                ›
              </span>
              {t("purchases.enterManually")}
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              <input
                type="text"
                placeholder={t("purchases.supplierName")}
                aria-label={t("purchases.supplierName")}
                defaultValue={watchedSupplierName}
                onBlur={(e) =>
                  form.setValue("supplierName", e.target.value.trim(), {
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
                placeholder={t("purchases.supplierPhone")}
                aria-label={t("purchases.supplierPhone")}
                defaultValue={watchedSupplierPhone}
                onBlur={(e) =>
                  form.setValue("supplierPhone", e.target.value.trim(), {
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
                  setSupplierSheetOpen(false);
                  setSupplierSearch("");
                }}
              >
                {t("common.close")}
              </Button>
            </div>
          </details>
        </div>
      </Modal>
    </>
  );
}

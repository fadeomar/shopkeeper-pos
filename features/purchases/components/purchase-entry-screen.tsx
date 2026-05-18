"use client";

import Link from "next/link";
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
import { formatCurrency } from "@/lib/utils/money";
import { createFinalizedPurchase } from "@/lib/services/purchase-service";
import { useAuth } from "@/components/providers/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
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
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-lg font-bold"
        >
          ✓
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-emerald-700">
            {t("purchases.purchaseCompleted")}
          </p>
          <p className="font-mono text-base font-bold text-slate-900">
            {purchase.purchaseNumber}
          </p>
        </div>
      </div>

      <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
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
  const currency = settings?.currency ?? "USD";
  const draftKey = user?.uid
    ? `${PURCHASE_DRAFT_KEY_PREFIX}:${user.uid}`
    : null;

  const [draftItems, setDraftItems] = useState<PurchaseDraftItem[]>([]);
  const [productId, setProductId] = useState("");
  const [newLineCost, setNewLineCost] = useState("");
  const [newLineQty, setNewLineQty] = useState("1");
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

  const [supplierFieldFocused, setSupplierFieldFocused] = useState(false);

  const form = useForm<PurchaseFormSchema>({
    resolver: zodResolver(purchaseFormSchema),
    defaultValues: {
      cashierName: settings?.cashierName ?? "Owner",
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
      setDraftItems(parsed.items ?? []);
      form.reset(parsed.form);
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
  const isMixedSplitValid = !isMixedPurchase || mixedSumDelta < 0.005;
  const hasCreditSupplier = Boolean(
    watchedSupplierName?.trim() || watchedSupplierPhone?.trim(),
  );
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
    if (Math.abs(watchedCashAmount + watchedCardAmount - total) < 0.005) return;
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

  // Supplier typeahead suggestions, mirror of POS customer typeahead.
  const supplierSuggestions = useMemo<Supplier[]>(() => {
    if (!suppliers || suppliers.length === 0) return [];
    if (!supplierFieldFocused) return [];
    const nameNeedle = watchedSupplierName?.trim().toLowerCase() ?? "";
    const phoneNeedle = normalizePhone(watchedSupplierPhone ?? "");
    if (!nameNeedle && !phoneNeedle) return [];
    const matches = suppliers.filter((s) => {
      const nameMatches =
        nameNeedle && s.name.toLowerCase().includes(nameNeedle);
      const phoneMatches =
        phoneNeedle && s.normalizedPhone?.includes(phoneNeedle);
      return Boolean(nameMatches || phoneMatches);
    });
    if (matches.length === 1) {
      const m = matches[0];
      const exact =
        (m.name.toLowerCase() === nameNeedle &&
          (phoneNeedle === "" || m.normalizedPhone === phoneNeedle)) ||
        (m.normalizedPhone === phoneNeedle &&
          (nameNeedle === "" || m.name.toLowerCase() === nameNeedle));
      if (exact) return [];
    }
    return matches.slice(0, 5);
  }, [
    suppliers,
    supplierFieldFocused,
    watchedSupplierName,
    watchedSupplierPhone,
  ]);

  function selectSupplier(supplier: Supplier) {
    form.setValue("supplierName", supplier.name, { shouldDirty: true });
    form.setValue("supplierPhone", supplier.phone ?? "", { shouldDirty: true });
    setSupplierFieldFocused(false);
  }

  function addLine() {
    const product = products?.find((p) => p.id === productId);
    if (!product) return;
    const qty = Math.max(1, Math.trunc(Number(newLineQty) || 0));
    const cost = Math.max(0, Number(newLineCost) || product.buyPrice);
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
    setNewLineCost("");
    setNewLineQty("1");
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
          i.productId === product.id
            ? { ...i, quantity: i.quantity + 1 }
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
      cashierName: settings?.cashierName ?? "Owner",
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
        error instanceof Error ? error.message : t("purchases.purchaseFailed"),
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
          <Input
            type="number"
            inputMode="numeric"
            enterKeyHint="done"
            min={1}
            value={item.quantity}
            onChange={(e) =>
              updateLine(item.productId, { quantity: Number(e.target.value) })
            }
            onKeyDown={dismissKeyboardOnEnter}
            className="w-20 text-center"
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
          <Input
            type="number"
            inputMode="decimal"
            enterKeyHint="done"
            step="0.01"
            min={0}
            value={item.unitCost}
            onChange={(e) =>
              updateLine(item.productId, { unitCost: Number(e.target.value) })
            }
            onKeyDown={dismissKeyboardOnEnter}
            className="w-24 text-center"
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
        >
          ×
        </Button>
      ),
    },
  ];

  if (!products) {
    return (
      <Card>
        <p className="text-sm text-slate-500">Loading…</p>
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
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
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
            <Input
              type="number"
              inputMode="numeric"
              enterKeyHint="done"
              min={1}
              value={newLineQty}
              onChange={(e) => setNewLineQty(e.target.value)}
              onKeyDown={dismissKeyboardOnEnter}
              placeholder={t("purchases.qty")}
              className="w-24"
            />
            <Input
              type="number"
              inputMode="decimal"
              enterKeyHint="done"
              step="0.01"
              min={0}
              value={newLineCost}
              onChange={(e) => setNewLineCost(e.target.value)}
              onKeyDown={dismissKeyboardOnEnter}
              placeholder={t("purchases.unitCost")}
              className="w-32"
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
              {t("billing.scan")}
            </Button>
          </div>

          {/* Items list */}
          {draftItems.length === 0 ? (
            <EmptyState
              title={t("purchases.addOneProduct")}
              description={t("purchases.subtitle")}
            />
          ) : (
            <>
              {/* Mobile touch-card layout */}
              <div className="flex flex-col gap-2 md:hidden">
                {draftItems.map((item) => (
                  <div
                    key={item.productId}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">
                        {item.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        <span dir="ltr">
                          {formatCurrency(item.unitCost, currency)}
                        </span>
                        {" × "}
                        {item.quantity}
                      </p>
                    </div>
                    <span
                      className="text-sm font-bold tabular-nums text-slate-900"
                      dir="ltr"
                    >
                      {formatCurrency(
                        calculateLineSubtotal(item.quantity, item.unitCost),
                        currency,
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeLine(item.productId)}
                      className="text-slate-400 hover:text-red-500 transition-colors p-1 text-lg leading-none"
                    >
                      ×
                    </button>
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
                <div className="relative flex flex-col gap-3">
                  <FormField label={t("purchases.supplierName")}>
                    <Input
                      {...form.register("supplierName")}
                      onFocus={() => setSupplierFieldFocused(true)}
                      onBlur={() => {
                        window.setTimeout(
                          () => setSupplierFieldFocused(false),
                          120,
                        );
                      }}
                    />
                  </FormField>
                  <FormField label={t("purchases.supplierPhone")}>
                    <Input
                      {...form.register("supplierPhone")}
                      onFocus={() => setSupplierFieldFocused(true)}
                      onBlur={() => {
                        window.setTimeout(
                          () => setSupplierFieldFocused(false),
                          120,
                        );
                      }}
                    />
                  </FormField>
                  {supplierSuggestions.length > 0 && (
                    <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-44 overflow-auto rounded-xl border border-slate-200 bg-white shadow-md divide-y divide-slate-100">
                      {supplierSuggestions.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => selectSupplier(s)}
                            className="w-full text-start px-3 py-2 hover:bg-slate-50"
                          >
                            <p className="text-sm font-medium text-slate-800 truncate">
                              {s.name}
                            </p>
                            {s.phone && (
                              <p className="text-xs text-slate-500 font-mono truncate">
                                {s.phone}
                              </p>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <FormField label={t("purchases.paymentMethod")}>
                  <SearchableSelect
                    value={form.watch("paymentMethod")}
                    onValueChange={(value) =>
                      form.setValue(
                        "paymentMethod",
                        (value ??
                          "cash") as PurchaseFormSchema["paymentMethod"],
                      )
                    }
                    placeholder={t("purchases.paymentMethod")}
                    searchPlaceholder={t("common.search")}
                    options={[
                      { value: "cash", label: t("common.cash") },
                      { value: "card", label: t("common.card") },
                      { value: "mixed", label: t("common.mixed") },
                      { value: "credit", label: t("common.credit") },
                    ]}
                  />
                </FormField>

                <div className="grid grid-cols-2 gap-3">
                  <FormField label={t("purchases.discount")}>
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
                  <FormField label={t("purchases.tax")}>
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

                {isMixedPurchase ? (
                  <FormField label={t("purchases.mixedSplit")}>
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
                        onChange={(e) => {
                          setIsPaidAmountManuallyEdited(true);
                          const v =
                            e.target.value === "" ? 0 : Number(e.target.value);
                          form.setValue(
                            "paidAmount",
                            Number.isFinite(v) ? v : 0,
                            {
                              shouldDirty: true,
                              shouldValidate: true,
                            },
                          );
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
                  <p className="text-xs text-red-600 font-medium">
                    {t("purchases.invalidTotal")}
                  </p>
                )}
                {isCreditPurchase &&
                  !hasCreditSupplier &&
                  draftItems.length > 0 && (
                    <p className="text-xs text-red-600 font-medium">
                      {t("purchases.creditSupplierRequired")}
                    </p>
                  )}
                {isMixedPurchase &&
                  !isMixedSplitValid &&
                  draftItems.length > 0 && (
                    <p className="text-xs text-red-600 font-medium">
                      {t("purchases.mixedSumMismatch")}
                    </p>
                  )}
                {hasValidTotal &&
                  !hasEnoughPayment &&
                  draftItems.length > 0 && (
                    <p className="text-xs text-red-600 font-medium">
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
    </>
  );
}

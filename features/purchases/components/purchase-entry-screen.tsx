"use client";

import Link from "next/link";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { createFinalizedPurchase } from "@/lib/services/purchase-service";
import { useAuth } from "@/components/providers/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { FormField } from "@/components/ui/form-field";
import { TableShell } from "@/components/ui/table-shell";
import { Toolbar } from "@/components/ui/toolbar";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { LoadingState } from "@/components/ui/loading-state";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import { PriceDisplay } from "@/components/pos/price-display";
import { CheckoutActionBar } from "@/components/pos/checkout-action-bar";
import {
  buttonSizes,
  buttonVariants,
  dividerClasses,
  focusRing,
  panelTones,
  surfaceClasses,
  typographyClasses,
} from "@/lib/design/variants";
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

function SummaryRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex items-center justify-between gap-3 border-b py-2 last:border-0",
        dividerClasses.borderSubtle,
      )}
    >
      <span
        className={clsx(
          "text-sm",
          highlight
            ? "font-semibold text-slate-900"
            : typographyClasses.bodyMuted,
        )}
      >
        {label}
      </span>
      <span
        className={clsx(
          "text-sm tabular-nums",
          highlight ? "font-bold text-slate-900" : "font-medium text-slate-700",
        )}
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
    <SectionCard
      tone="success"
      padding="md"
      title={
        <span className="flex items-center gap-2">
          <StatusPill
            status="completed"
            tone="success"
            label={t("purchases.purchaseCompleted")}
          />
          <span className="font-mono text-base font-bold text-slate-900">
            {purchase.purchaseNumber}
          </span>
        </span>
      }
    >
      <div
        className={clsx(
          "rounded-xl border px-4 py-3",
          panelTones.success,
          "bg-white/70 text-slate-700",
        )}
      >
        <SummaryRow
          label={t("purchases.total")}
          value={
            <PriceDisplay
              value={purchase.totalAmount}
              currency={currency}
              emphasis
            />
          }
          highlight
        />
        <SummaryRow
          label={t("purchases.paid")}
          value={
            <PriceDisplay value={purchase.paidAmount} currency={currency} />
          }
        />
        {amountDue > 0 && (
          <SummaryRow
            label={t("purchases.amountDue")}
            value={
              <PriceDisplay value={amountDue} currency={currency} emphasis />
            }
            highlight
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Link
          href={"/purchases" as never}
          className={clsx(
            "h-11",
            buttonSizes.md,
            buttonVariants.outline,
            focusRing,
          )}
        >
          {t("purchases.historyTitle")}
        </Link>
        <Button ref={newRef} type="button" onClick={onDismiss} fullWidth>
          {t("purchases.newPurchaseAction")}
        </Button>
      </div>
    </SectionCard>
  );
}

export function PurchaseEntryScreen() {
  const { t } = useLocale();
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
  const [isPaidAmountManuallyEdited, setIsPaidAmountManuallyEdited] =
    useState(false);
  const [lastFinalized, setLastFinalized] = useState<{
    purchase: Purchase;
    items: PurchaseItem[];
  } | null>(null);
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

  if (!products) {
    return (
      <PageShell size="wide">
        <PageHeader
          title={t("purchases.title")}
          description={t("purchases.subtitle")}
        />
        <LoadingState />
      </PageShell>
    );
  }

  return (
    <PageShell size="wide">
      <PageHeader
        title={t("purchases.title")}
        description={t("purchases.subtitle")}
      />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-5">
        {/* Build purchase panel */}
        <SectionCard
          title={t("purchases.title")}
          actions={
            draftItems.length > 0 ? (
              <Badge tone="info">
                {draftItems.length} {t("purchases.items")}
              </Badge>
            ) : undefined
          }
          padding="md"
        >
          {/* Product + qty + cost entry */}
          <Toolbar
            align="between"
            className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto]"
          >
            <Select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">{t("purchases.selectProduct")}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.quantityInStock})
                </option>
              ))}
            </Select>
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
          </Toolbar>

          {/* Items list */}
          {draftItems.length === 0 ? (
            <EmptyState
              title={t("purchases.addOneProduct")}
              description={t("purchases.subtitle")}
            />
          ) : (
            <TableShell>
              <table className="min-w-[560px] w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    {[
                      t("purchases.item"),
                      t("purchases.currentStock"),
                      t("purchases.qty"),
                      t("purchases.cost"),
                      t("purchases.subtotal"),
                      "",
                    ].map((h) => (
                      <th key={h} className={typographyClasses.tableHeader}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {draftItems.map((item) => (
                    <tr key={item.productId} className="hover:bg-slate-50/50">
                      <td className={typographyClasses.tableCellStrong}>
                        {item.name}
                      </td>
                      <td
                        className={clsx(
                          typographyClasses.tableCellMuted,
                          "tabular-nums",
                        )}
                      >
                        {item.currentStock}
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="number"
                          inputMode="numeric"
                          enterKeyHint="done"
                          min={1}
                          value={item.quantity}
                          onChange={(e) =>
                            updateLine(item.productId, {
                              quantity: Number(e.target.value),
                            })
                          }
                          onKeyDown={dismissKeyboardOnEnter}
                          className="w-20 text-center"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="number"
                          inputMode="decimal"
                          enterKeyHint="done"
                          step="0.01"
                          min={0}
                          value={item.unitCost}
                          onChange={(e) =>
                            updateLine(item.productId, {
                              unitCost: Number(e.target.value),
                            })
                          }
                          onKeyDown={dismissKeyboardOnEnter}
                          className="w-24 text-center"
                        />
                      </td>
                      <td
                        className={clsx(
                          typographyClasses.tableCellStrong,
                          "tabular-nums",
                        )}
                      >
                        <PriceDisplay
                          value={calculateLineSubtotal(
                            item.quantity,
                            item.unitCost,
                          )}
                          currency={currency}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeLine(item.productId)}
                        >
                          ×
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </SectionCard>

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
            <SectionCard title={t("purchases.finalizePurchase")} padding="md">
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
                    <ul
                      className={clsx(
                        "absolute left-0 right-0 top-full z-20 mt-1 max-h-44 overflow-auto rounded-xl border shadow-md",
                        dividerClasses.borderDefault,
                        surfaceClasses.surface,
                        dividerClasses.subtle,
                      )}
                    >
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
                  <Select {...form.register("paymentMethod")}>
                    <option value="cash">{t("common.cash")}</option>
                    <option value="card">{t("common.card")}</option>
                    <option value="mixed">{t("common.mixed")}</option>
                    <option value="credit">{t("common.credit")}</option>
                  </Select>
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
                        <span className={typographyClasses.statLabel}>
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
                        <span className={typographyClasses.statLabel}>
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

                <div
                  className={clsx(
                    "rounded-xl border px-4 py-3",
                    dividerClasses.borderDefault,
                    surfaceClasses.surfaceSoft,
                  )}
                >
                  <SummaryRow
                    label={t("purchases.subtotal")}
                    value={
                      <PriceDisplay
                        value={purchaseSummary.subtotal}
                        currency={currency}
                      />
                    }
                  />
                  <SummaryRow
                    label={t("purchases.total")}
                    value={
                      <PriceDisplay
                        value={purchaseSummary.totalAmount}
                        currency={currency}
                        emphasis
                      />
                    }
                    highlight
                  />
                  <SummaryRow
                    label={t("purchases.change")}
                    value={
                      <PriceDisplay
                        value={Math.max(0, actualChangeAmount)}
                        currency={currency}
                      />
                    }
                  />
                  {isCreditPurchase && amountDue > 0 && (
                    <SummaryRow
                      label={t("purchases.amountDue")}
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

                <div className="flex flex-col items-start gap-2">
                  {!hasValidTotal && draftItems.length > 0 && (
                    <Badge tone="danger">{t("purchases.invalidTotal")}</Badge>
                  )}
                  {isCreditPurchase &&
                    !hasCreditSupplier &&
                    draftItems.length > 0 && (
                      <Badge tone="danger">
                        {t("purchases.creditSupplierRequired")}
                      </Badge>
                    )}
                  {isMixedPurchase &&
                    !isMixedSplitValid &&
                    draftItems.length > 0 && (
                      <Badge tone="danger">
                        {t("purchases.mixedSumMismatch")}
                      </Badge>
                    )}
                  {hasValidTotal &&
                    !hasEnoughPayment &&
                    draftItems.length > 0 && (
                      <Badge tone="danger">
                        {t("purchases.paidBelowTotal")}
                      </Badge>
                    )}
                </div>

                <CheckoutActionBar
                  sticky={false}
                  className="grid grid-cols-1 border-t-0 bg-transparent p-0 shadow-none sm:grid-cols-2"
                >
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
                </CheckoutActionBar>
              </form>
            </SectionCard>
          )}
        </div>
      </div>

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
        <div
          className={clsx(
            "rounded-xl border px-4 py-3",
            dividerClasses.borderDefault,
            surfaceClasses.surfaceSoft,
          )}
        >
          <SummaryRow
            label={t("purchases.items")}
            value={<Badge tone="info">{draftItems.length}</Badge>}
          />
          <SummaryRow
            label={t("purchases.total")}
            value={
              <PriceDisplay
                value={purchaseSummary.totalAmount}
                currency={currency}
                emphasis
              />
            }
            highlight
          />
          <SummaryRow
            label={t("purchases.paid")}
            value={
              <PriceDisplay value={actualPaidAmount} currency={currency} />
            }
          />
          {amountDue > 0 && (
            <SummaryRow
              label={t("purchases.amountDue")}
              value={
                <PriceDisplay value={amountDue} currency={currency} emphasis />
              }
              highlight
            />
          )}
        </div>
      </Modal>
    </PageShell>
  );
}

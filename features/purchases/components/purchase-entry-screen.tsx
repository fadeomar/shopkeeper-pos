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
import {
  creditAwareDefaultPaidAmount,
  resolveActualPaidAmount,
  wasPaidAmountManuallyEdited,
} from "@/features/bills/utils/paid-amount";
import { formatCurrency } from "@/lib/utils/money";
import { blurInputOnEnter } from "@/lib/utils/dismiss-on-enter";
import { createFinalizedPurchase } from "@/lib/services/purchase-service";
import { useAuth } from "@/components/providers/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput, MoneyInputRHF } from "@/components/ui/money-input";
import { QuantityStepper } from "@/components/pos/quantity-stepper";
import { NumberField } from "@/components/ui/number-field";
import { formatStockDisplay, gramsToKg, kgToGrams } from "@/lib/utils/weight";
import { PaymentMethodControl } from "@/components/pos/payment-method-control";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CircleCheck, Phone, Search, Store, UserPlus, X } from "lucide-react";
import { DataTable, useDataTableLabels } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { BarcodeScannerModal } from "@/components/barcode/barcode-scanner-modal";
import { PurchaseQuickProductModal } from "@/features/purchases/components/purchase-quick-product-modal";
import { normalizeBarcode } from "@/lib/utils/barcode";
import { nowIso } from "@/lib/utils/date";
import { createId } from "@/lib/utils/id";
import { isMiscLine, MISC_ITEM_BARCODE } from "@/lib/utils/misc-items";
import { useLocale } from "@/components/providers/locale-context";
import { Card } from "@/components/ui/card";
import type {
  Purchase,
  PurchaseDraftItem,
  PurchaseItem,
  Product,
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
        {purchase.changeAmount > 0.001 && (
          <SummaryRow
            label={t("purchases.changeDueBack")}
            value={formatCurrency(purchase.changeAmount, currency)}
          />
        )}
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
          className="inline-flex h-10 items-center justify-center rounded-xl border border-border-default bg-surface px-4 text-sm font-medium text-fg-secondary hover:bg-surface-soft"
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
  const activeShift = useLiveQuery(
    () => db.shifts.where("status").equals("open").first().then((shift) => shift ?? null),
    [],
  );
  const { push } = useToast();
  const currency = settings?.currency ?? "ILS";
  const draftKey = user?.uid
    ? `${PURCHASE_DRAFT_KEY_PREFIX}:${user.uid}`
    : null;

  const [draftItems, setDraftItems] = useState<PurchaseDraftItem[]>([]);
  const [draftRestored, setDraftRestored] = useState(false);
  const [productId, setProductId] = useState("");
  const [newLineCost, setNewLineCost] = useState<number>(0);
  const [isNewLineCostManuallyEdited, setIsNewLineCostManuallyEdited] =
    useState(false);
  const [newLineQty, setNewLineQty] = useState<number>(1);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddBarcode, setQuickAddBarcode] = useState("");
  const [quickAddDefaultQuantity, setQuickAddDefaultQuantity] = useState(1);
  const [inventoryPrefillProductId, setInventoryPrefillProductId] = useState<string | null>(null);
  const consumedInventoryPrefillId = useRef<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [miscOpen, setMiscOpen] = useState(false);
  const [miscDescription, setMiscDescription] = useState("");
  const [miscCost, setMiscCost] = useState("");
  const [miscQuantity, setMiscQuantity] = useState("1");
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
  const selectedProductForLine = useMemo(
    () => products?.find((product) => product.id === productId),
    [products, productId],
  );
  const defaultRecordedBy = useMemo(
    () =>
      settings?.cashierName?.trim() ||
      user?.name?.trim() ||
      user?.email?.trim() ||
      t("common.owner"),
    [settings?.cashierName, user?.name, user?.email, t],
  );
  const lastSelectedProductId = useRef<string>("");

  const [supplierSheetOpen, setSupplierSheetOpen] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [manualSupplierName, setManualSupplierName] = useState("");
  const [manualSupplierPhone, setManualSupplierPhone] = useState("");
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);

  const form = useForm<PurchaseFormSchema>({
    resolver: zodResolver(purchaseFormSchema),
    defaultValues: {
      cashierName: settings?.cashierName ?? t("common.owner"),
      supplierName: "",
      supplierPhone: "",
      supplierInvoiceNumber: "",
      invoiceDate: "",
      paymentDueDate: "",
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
    setDraftRestored(false);
    if (!draftKey) {
      setDraftRestored(true);
      return;
    }
    const raw = window.localStorage.getItem(draftKey);
    if (!raw) {
      setDraftRestored(true);
      return;
    }
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
      setIsPaidAmountManuallyEdited(
        wasPaidAmountManuallyEdited(
          parsed.form.paidAmount,
          parsed.form.paymentMethod,
          autoTotal,
        ),
      );
    } catch {
      window.localStorage.removeItem(draftKey);
    } finally {
      setDraftRestored(true);
    }
  }, [draftKey, form]);

  const watchedSupplierName = form.watch("supplierName");
  const watchedSupplierPhone = form.watch("supplierPhone");
  const watchedSupplierInvoiceNumber = form.watch("supplierInvoiceNumber");
  const watchedInvoiceDate = form.watch("invoiceDate");
  const watchedPaymentDueDate = form.watch("paymentDueDate");
  const watchedPaymentMethod = form.watch("paymentMethod");
  const watchedDiscountAmount = Number(form.watch("discountAmount") || 0);
  const watchedTaxAmount = Number(form.watch("taxAmount") || 0);
  const watchedPaidAmount = Number(form.watch("paidAmount") || 0);
  const watchedCashierName = form.watch("cashierName");

  useEffect(() => {
    if (!supplierSheetOpen) return;
    const searchValue = supplierSearch.trim();
    const searchLooksLikePhone = Boolean(normalizePhone(searchValue));
    setManualSupplierName(watchedSupplierName?.trim() || (searchLooksLikePhone ? "" : searchValue));
    setManualSupplierPhone(watchedSupplierPhone?.trim() || (searchLooksLikePhone ? searchValue : ""));
    // Only seed the manual form when the sheet opens; after that, the fields are user-controlled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierSheetOpen]);

  async function saveManualSupplier() {
    const name = manualSupplierName.trim();
    const phone = manualSupplierPhone.trim();
    if (!name && !phone) {
      push(t("purchases.supplierRequired"), "error");
      return;
    }

    setIsSavingSupplier(true);
    try {
      const normalizedPhone = normalizePhone(phone);
      const existing = normalizedPhone
        ? await supplierRepo.findByNormalizedPhone(normalizedPhone)
        : undefined;
      const now = nowIso();
      const supplier: Supplier = {
        id: existing?.id ?? createId("supp"),
        name: name || existing?.name || t("purchases.supplierName"),
        phone: phone || undefined,
        normalizedPhone: normalizedPhone || undefined,
        notes: existing?.notes,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        syncStatus: "pending",
      };

      await supplierRepo.save(supplier);
      selectSupplier(supplier);
      setSupplierSheetOpen(false);
      setSupplierSearch("");
      setManualSupplierName("");
      setManualSupplierPhone("");
      push({
        title: existing ? t("purchases.supplierUpdated") : t("purchases.supplierSaved"),
        description: t("purchases.supplierSelected"),
        tone: "success",
      });
    } catch (error) {
      push(getServiceErrorMessage(error, t, t("purchases.supplierSaveFailed")), "error");
    } finally {
      setIsSavingSupplier(false);
    }
  }

  const canSaveManualSupplier = Boolean(
    manualSupplierName.trim() || manualSupplierPhone.trim(),
  );

  // Keep the saved purchase metadata meaningful even when Settings/auth data
  // arrives after the form was first created. The field is read-only in the UI,
  // so this intentionally follows the current cashier/default setting.
  useEffect(() => {
    if (!defaultRecordedBy) return;
    if (watchedCashierName === defaultRecordedBy) return;
    form.setValue("cashierName", defaultRecordedBy, {
      shouldDirty: false,
      shouldValidate: true,
    });
  }, [defaultRecordedBy, watchedCashierName, form]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedProductId = params.get("productId");
    if (requestedProductId && params.get("source") === "inventory") {
      setInventoryPrefillProductId(requestedProductId);
    }
  }, []);

  function clearConsumedPurchaseQuery() {
    if (typeof window === "undefined") return;
    if (!window.location.search) return;
    window.history.replaceState(null, "", window.location.pathname);
  }

  function suggestRestockQuantity(product: Product): number {
    // For weight products the stock/threshold are grams; convert the deficit to
    // kilograms (the entry unit). Default to 1 kg / 1 piece when not low.
    const deficitBase = (product.minimumStockAlert ?? 0) - (product.quantityInStock ?? 0);
    if (product.saleType === "weight") {
      return Math.max(1, gramsToKg(Math.max(0, deficitBase)) || 1);
    }
    return Math.max(1, Math.ceil(deficitBase));
  }

  // Smart default for the line cost: selecting a product shows its buy price
  // immediately, but typing a custom cost is preserved while the same product
  // remains selected. Changing products starts with the new product's buy price.
  useEffect(() => {
    if (!selectedProductForLine) {
      lastSelectedProductId.current = "";
      setNewLineCost(0);
      setIsNewLineCostManuallyEdited(false);
      return;
    }

    const productChanged = lastSelectedProductId.current !== selectedProductForLine.id;
    if (productChanged) {
      lastSelectedProductId.current = selectedProductForLine.id;
      setNewLineCost(selectedProductForLine.buyPrice);
      setIsNewLineCostManuallyEdited(false);
      return;
    }

    if (!isNewLineCostManuallyEdited) {
      setNewLineCost(selectedProductForLine.buyPrice);
    }
  }, [selectedProductForLine, isNewLineCostManuallyEdited]);

  useEffect(() => {
    if (!draftRestored || !products || !inventoryPrefillProductId) return;
    if (consumedInventoryPrefillId.current === inventoryPrefillProductId) return;
    consumedInventoryPrefillId.current = inventoryPrefillProductId;

    const product = products.find(
      (candidate) =>
        candidate.id === inventoryPrefillProductId &&
        candidate.status === "active",
    );

    if (!product) {
      push(t("purchases.prefillProductNotFound"), "error");
      clearConsumedPurchaseQuery();
      return;
    }

    if (draftItems.some((item) => item.productId === product.id)) {
      push(
        t("purchases.alreadyInPurchaseDraft", { name: product.name }),
        "error",
      );
      clearConsumedPurchaseQuery();
      return;
    }

    setProductId(product.id);
    setNewLineQty(suggestRestockQuantity(product));
    setNewLineCost(product.buyPrice);
    setIsNewLineCostManuallyEdited(false);
    push(t("purchases.prefilledFromInventory", { name: product.name }));
    clearConsumedPurchaseQuery();
  }, [draftItems, draftRestored, inventoryPrefillProductId, products, push, t]);

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
    watchedSupplierInvoiceNumber,
    watchedInvoiceDate,
    watchedPaymentDueDate,
    watchedPaymentMethod,
    watchedDiscountAmount,
    watchedTaxAmount,
    watchedPaidAmount,
    watchedCashierName,
    form,
  ]);

  const selectedLineCostDiffers = Boolean(
    selectedProductForLine &&
      Math.abs(newLineCost - selectedProductForLine.buyPrice) > 0.001,
  );
  const selectedLineEstimatedMargin = selectedProductForLine
    ? selectedProductForLine.sellPrice - newLineCost
    : 0;
  const selectedLineMarginPercent = selectedProductForLine?.sellPrice
    ? (selectedLineEstimatedMargin / selectedProductForLine.sellPrice) * 100
    : 0;
  const selectedLineLowMargin = Boolean(
    selectedProductForLine &&
      selectedProductForLine.sellPrice > 0 &&
      selectedLineMarginPercent <= 10,
  );

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
  const defaultPaidAmount = creditAwareDefaultPaidAmount(
    watchedPaymentMethod,
    purchaseSummary.totalAmount,
  );
  const actualPaidAmount = resolveActualPaidAmount(
    isPaidAmountManuallyEdited,
    watchedPaidAmount,
    defaultPaidAmount,
  );
  const actualChangeAmount = calculateChange(
    actualPaidAmount,
    purchaseSummary.totalAmount,
  );
  const amountDue = Math.max(
    0,
    calculateChange(purchaseSummary.totalAmount, actualPaidAmount),
  );
  const hasCreditSupplier = Boolean(
    watchedSupplierName?.trim() || watchedSupplierPhone?.trim(),
  );

  useEffect(() => {
    if (!isCreditPurchase && watchedPaymentDueDate) {
      form.setValue("paymentDueDate", "", { shouldDirty: true });
    }
  }, [form, isCreditPurchase, watchedPaymentDueDate]);

  // ── Settings-driven enforcement (payment methods + tax/shift mode) ─────────
  // Purchases share the store's payment-method toggles. Mixed payment is
  // retired and intentionally not offered as a new-purchase option. When
  // requireShift is enabled, any cash-affecting purchase needs an open shift so
  // drawer math stays complete.
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
  const hasEnoughPayment = isCreditPurchase || actualChangeAmount >= 0;
  const requireShift = settings?.requireShift === true;
  const cashAffectsDrawer =
    watchedPaymentMethod === "cash" ||
    (watchedPaymentMethod === "credit" && actualPaidAmount > 0);
  const shiftBlocked = requireShift && cashAffectsDrawer && activeShift === null;
  const canFinalize =
    draftItems.length > 0 &&
    hasValidTotal &&
    hasEnoughPayment &&
    !shiftBlocked &&
    (!isCreditPurchase || hasCreditSupplier);

  // Auto-fill paid amount on total change (unless cashier manually overrode).
  useEffect(() => {
    if (isPaidAmountManuallyEdited) return;
    form.setValue("paidAmount", defaultPaidAmount, {
      shouldDirty: false,
      shouldValidate: true,
    });
  }, [defaultPaidAmount, isPaidAmountManuallyEdited, form]);


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

  function addProductToDraft(product: Product, quantity: number, unitCost: number) {
    const isWeight = product.saleType === "weight";
    // Weight buys kilograms (fractional ok); unit buys whole pieces.
    const qty = isWeight
      ? Math.max(0, quantity || 0)
      : Math.max(1, Math.trunc(quantity || 0));
    const cost = Math.max(0, unitCost || product.buyPrice);
    setDraftItems((cur) => {
      const existing = cur.find((i) => i.productId === product.id);
      if (existing) {
        return cur.map((i) => {
          if (i.productId !== product.id) return i;
          const nextQty = i.quantity + qty;
          return {
            ...i,
            quantity: nextQty,
            baseQuantity: isWeight ? kgToGrams(nextQty) : undefined,
            unitCost: cost,
          };
        });
      }
      return [
        ...cur,
        {
          productId: product.id,
          barcode: product.barcode,
          name: product.name,
          category: product.category,
          saleType: isWeight ? "weight" : undefined,
          currentStock: product.quantityInStock,
          baseQuantity: isWeight ? kgToGrams(qty) : undefined,
          quantity: qty,
          unitCost: cost,
          unitSellPriceBefore: product.sellPrice,
        },
      ];
    });
    if (lastFinalized) setLastFinalized(null);
  }

  function addLine() {
    const product = products?.find((p) => p.id === productId);
    if (!product) return;
    addProductToDraft(product, newLineQty, newLineCost);
    setProductId("");
    setNewLineCost(0);
    setIsNewLineCostManuallyEdited(false);
    setNewLineQty(1);
  }

  function resetMiscForm() {
    setMiscDescription("");
    setMiscCost("");
    setMiscQuantity("1");
  }

  function addMiscPurchaseLine() {
    const cost = Math.max(0, Number(miscCost) || 0);
    const quantity = Math.max(1, Math.trunc(Number(miscQuantity) || 1));
    const description = miscDescription.trim();

    if (cost <= 0) {
      push(t("purchases.miscCostRequired"), "error");
      return;
    }

    const name = description
      ? `${t("purchases.miscPurchaseItem")} - ${description}`
      : t("purchases.miscPurchaseItem");

    setDraftItems((cur) => [
      ...cur,
      {
        productId: createId("misc"),
        itemKind: "misc",
        miscDescription: description || undefined,
        barcode: MISC_ITEM_BARCODE,
        name,
        category: t("purchases.miscCategory"),
        currentStock: 0,
        quantity,
        unitCost: cost,
        unitSellPriceBefore: 0,
      },
    ]);
    setMiscOpen(false);
    resetMiscForm();
    if (lastFinalized) setLastFinalized(null);
  }

  function handleScanForPurchase(barcode: string) {
    const bc = normalizeBarcode(barcode);
    const product = products?.find((p) => normalizeBarcode(p.barcode) === bc);
    if (!product) {
      setQuickAddBarcode(bc);
      setQuickAddDefaultQuantity(1);
      setQuickAddOpen(true);
      push(t("purchases.noProductFoundForBarcode", { barcode: bc }), "error");
      return;
    }
    addProductToDraft(product, 1, product.buyPrice);
  }

  function updateLine(
    productIdToUpdate: string,
    patch: Partial<PurchaseDraftItem>,
  ) {
    setDraftItems((cur) =>
      cur.map((i) => {
        if (i.productId !== productIdToUpdate) return i;
        const next = { ...i, ...patch };
        if (next.saleType === "weight") {
          // Weight quantity is kilograms (fractional); keep grams in sync.
          next.quantity = Number.isFinite(next.quantity) ? Math.max(0, next.quantity) : 0;
          next.baseQuantity = kgToGrams(next.quantity);
        } else {
          next.quantity = Number.isFinite(next.quantity)
            ? Math.max(1, Math.trunc(next.quantity))
            : 1;
        }
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
      cashierName: defaultRecordedBy,
      supplierName: "",
      supplierPhone: "",
      supplierInvoiceNumber: "",
      invoiceDate: "",
      paymentDueDate: "",
      paymentMethod: "cash",
      discountAmount: 0,
      taxAmount: 0,
      paidAmount: 0,
      cashAmount: 0,
      cardAmount: 0,
      notes: "",
    });
    setProductId("");
    setNewLineCost(0);
    setNewLineQty(1);
    setIsNewLineCostManuallyEdited(false);
    setInventoryPrefillProductId(null);
    consumedInventoryPrefillId.current = null;
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
          cashierName: defaultRecordedBy,
          paidAmount: actualPaidAmount,
        },
      });
      clearDraft();
      setConfirmOpen(false);
      setLastFinalized({ purchase, items: purchaseItems });
      push(t("purchases.purchaseCreated", { purchaseNumber: purchase.purchaseNumber }));
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
          {isMiscLine(row.original)
            ? t("purchases.nonStock")
            : formatStockDisplay(row.original.saleType, row.original.currentStock)}
        </span>
      ),
    },
    {
      accessorKey: "quantity",
      header: t("purchases.qty"),
      cell: ({ row }) => {
        const item = row.original;
        // Weight lines buy kilograms (fractional) — a decimal field with a kg
        // suffix instead of a 1-step counter.
        if (item.saleType === "weight") {
          return (
            <div className="flex items-center gap-1">
              <NumberField
                value={item.quantity}
                onValueChange={(v) => updateLine(item.productId, { quantity: v })}
                precision="decimal"
                min={0}
                onKeyDown={dismissKeyboardOnEnter}
                className="w-[120px]"
                fullWidth={false}
              />
              <span className="text-xs text-slate-400">{t("weight.kgUnit")}</span>
            </div>
          );
        }
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
          <div className="flex items-center gap-1">
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
            {item.saleType === "weight" && (
              <span className="text-xs text-slate-400">{t("weight.perKgSuffix")}</span>
            )}
          </div>
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

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-4 xl:gap-5 items-start pb-28 lg:pb-0">
        <div className="flex flex-col gap-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto_auto_auto] gap-2">
            <SearchableSelect
              value={productId}
              onValueChange={(value) => setProductId(value ?? "")}
              options={productOptions}
              placeholder={t("purchases.selectProduct")}
              searchPlaceholder={t("products.searchPlaceholder")}
              emptyMessage={t("products.noProducts")}
              disabled={!products?.length}
            />
            {selectedProductForLine?.saleType === "weight" ? (
              <div className="flex items-center gap-1">
                <NumberField
                  value={newLineQty}
                  onValueChange={setNewLineQty}
                  precision="decimal"
                  min={0}
                  className="w-[120px]"
                  fullWidth={false}
                />
                <span className="text-xs text-slate-400">{t("weight.kgUnit")}</span>
              </div>
            ) : (
              <QuantityStepper
                value={newLineQty}
                onChange={setNewLineQty}
                min={1}
                className="w-[140px]"
              />
            )}
            <MoneyInput
              value={newLineCost}
              onValueChange={(value) => {
                setIsNewLineCostManuallyEdited(true);
                setNewLineCost(value);
              }}
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
            <Button
              type="button"
              variant="soft"
              onClick={() => setMiscOpen(true)}
            >
              {t("purchases.addMiscPurchase")}
            </Button>
          </div>

          {(selectedLineCostDiffers || selectedLineLowMargin) && selectedProductForLine && (
            <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
              <p className="font-semibold text-slate-900">
                {t("purchases.purchaseCostChanged")}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-700 sm:grid-cols-4">
                <span>{t("purchases.currentCost")}: <strong dir="ltr">{formatCurrency(selectedProductForLine.buyPrice, currency)}</strong></span>
                <span>{t("purchases.newCost")}: <strong dir="ltr">{formatCurrency(newLineCost, currency)}</strong></span>
                <span>{t("purchases.sellPrice")}: <strong dir="ltr">{formatCurrency(selectedProductForLine.sellPrice, currency)}</strong></span>
                <span>{t("purchases.estimatedMargin")}: <strong dir="ltr">{formatCurrency(selectedLineEstimatedMargin, currency)} ({selectedLineMarginPercent.toFixed(1)}%)</strong></span>
              </div>
              {selectedLineCostDiffers && (
                <p className="mt-2 text-xs font-medium">{t("purchases.buyPriceWillUpdateDetailed")}</p>
              )}
              {selectedLineLowMargin && (
                <p className="mt-1 text-xs font-semibold text-danger">
                  {t("purchases.reviewSellPrice")}
                </p>
              )}
            </div>
          )}

          <div className="rounded-xl border border-dashed border-border-default bg-surface-soft/55 px-4 py-3 text-sm text-fg-muted">
            <p>{t("purchases.productMissingNote")}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => {
                setQuickAddBarcode("");
                setQuickAddDefaultQuantity(newLineQty || 1);
                setQuickAddOpen(true);
              }}
            >
              {t("purchases.addMissingProduct")}
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
              {/* Mobile touch-card layout — fully editable qty + cost */}
              <div className="flex flex-col gap-2 md:hidden">
                {draftItems.map((item) => (
                  <div
                    key={item.productId}
                    className="rounded-2xl border border-border-default bg-surface p-3 shadow-xs"
                  >
                    {/* Header: name + remove */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {item.name}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {t("purchases.currentStock")}:{" "}
                          {isMiscLine(item)
                            ? t("purchases.nonStock")
                            : formatStockDisplay(item.saleType, item.currentStock)}
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
                          {item.saleType === "weight" ? t("weight.purchaseQtyKg") : t("purchases.qty")}
                        </span>
                        {item.saleType === "weight" ? (
                          <NumberField
                            value={item.quantity}
                            onValueChange={(v) =>
                              updateLine(item.productId, { quantity: v })
                            }
                            precision="decimal"
                            min={0}
                            onKeyDown={dismissKeyboardOnEnter}
                            fullWidth
                          />
                        ) : (
                          <QuantityStepper
                            value={item.quantity}
                            onChange={(v) =>
                              updateLine(item.productId, { quantity: v })
                            }
                            min={1}
                            className="w-full"
                          />
                        )}
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

          {lastFinalized && (
            <SuccessPanel
              purchase={lastFinalized.purchase}
              items={lastFinalized.items}
              settings={settings}
              currency={currency}
              onDismiss={() => setLastFinalized(null)}
            />
          )}
        </div>

        {/* Summary panel */}
        <div className="xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto xl:pe-1">
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

                <details className="group rounded-xl border border-border-default bg-surface px-3 py-2">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-slate-700">
                    {t("purchases.invoiceDetails")}
                    <span className="ms-2 text-xs font-normal text-slate-400">
                      {t("purchases.invoiceDetailsHelper")}
                    </span>
                  </summary>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField label={t("purchases.supplierInvoiceNumber")}>
                      <Input {...form.register("supplierInvoiceNumber")} />
                    </FormField>
                    <FormField label={t("purchases.invoiceDate")}>
                      <Input type="date" {...form.register("invoiceDate")} />
                    </FormField>
                    {isCreditPurchase && (
                      <FormField label={t("purchases.paymentDueDate")}>
                        <Input type="date" {...form.register("paymentDueDate")} />
                      </FormField>
                    )}
                  </div>
                </details>

                {/* Not a FormField: its <label> would bind to the first radio
                    (Cash) and pollute that radio's accessible name. The
                    radiogroup already self-labels via aria-label. */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                    {t("purchases.paymentMethod")}
                  </span>
                  <PaymentMethodControl
                    value={watchedPaymentMethod as PurchaseFormSchema["paymentMethod"]}
                    onChange={(v) =>
                      form.setValue("paymentMethod", v, { shouldDirty: true })
                    }
                    label={t("purchases.paymentMethod")}
                    available={availablePaymentMethods}
                  />
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("purchases.recordedBy")}
                  </p>
                  <p className="mt-0.5 truncate text-sm font-semibold text-slate-800">
                    {defaultRecordedBy}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {t("purchases.recordedByHelper")}
                  </p>
                </div>

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

                {watchedPaymentMethod === "card" ? null : (
                  <FormField
                    label={
                      isCreditPurchase
                        ? t("purchases.paidNow")
                        : t("purchases.actualPaid")
                    }
                  >
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

                <div className="rounded-xl border border-border-default bg-surface-soft/60 px-4 py-3">
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
                  {actualChangeAmount > 0.001 && (
                    <>
                      <SummaryRow
                        label={t("purchases.changeDueBack")}
                        value={formatCurrency(actualChangeAmount, currency)}
                      />
                      <p className="pt-2 text-xs text-fg-muted">
                        {t("purchases.changeHelper")}
                      </p>
                    </>
                  )}
                  {isCreditPurchase && amountDue > 0.001 && (
                    <>
                      <SummaryRow
                        label={t("purchases.amountDue")}
                        value={formatCurrency(amountDue, currency)}
                        highlight
                      />
                      <p className="pt-2 text-xs text-fg-muted">
                        {t("purchases.amountDueHelper")}
                      </p>
                    </>
                  )}
                </div>

                {shiftBlocked && draftItems.length > 0 && (
                  <p className="text-xs text-danger font-medium">
                    {t("purchases.shiftRequiredError")}
                  </p>
                )}

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
        </div>
      </div>

      {/* ── Misc purchase modal ──────────────────────────────────────────── */}
      <Modal
        open={miscOpen}
        title={t("purchases.addMiscPurchase")}
        description={t("purchases.miscPurchaseDesc")}
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
            <Button type="button" onClick={addMiscPurchaseLine}>
              {t("purchases.addMiscToPurchase")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <FormField label={t("purchases.miscDescription")}>
            <Input
              value={miscDescription}
              onChange={(e) => setMiscDescription(e.target.value)}
              placeholder={t("purchases.miscDescriptionPlaceholder")}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("purchases.qty")}>
              <QuantityStepper
                value={Number(miscQuantity) || 1}
                onChange={(v) => setMiscQuantity(String(v))}
                min={1}
                className="w-full"
              />
            </FormField>
            <FormField label={t("purchases.cost")}>
              <MoneyInput
                value={miscCost === "" ? "" : Number(miscCost)}
                onValueChange={(v) => setMiscCost(String(v))}
                currency={currency}
                min={0}
                onKeyDown={dismissKeyboardOnEnter}
              />
            </FormField>
          </div>
          <p className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
            {t("purchases.miscPurchaseNote")}
          </p>
        </div>
      </Modal>

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleScanForPurchase}
        continuous
      />

      <PurchaseQuickProductModal
        open={quickAddOpen}
        barcode={quickAddBarcode}
        currency={currency}
        defaultQuantity={quickAddDefaultQuantity}
        supplierName={watchedSupplierName}
        onClose={() => setQuickAddOpen(false)}
        onCreated={(product, quantity) => {
          addProductToDraft(product, quantity, product.buyPrice);
          setQuickAddOpen(false);
          setQuickAddBarcode("");
          setProductId("");
          setNewLineQty(1);
          setNewLineCost(0);
          setIsNewLineCostManuallyEdited(false);
          push(t("purchases.quickAddCreated", { name: product.name }));
        }}
        onUseExisting={(product) => {
          setProductId(product.id);
          setNewLineQty(1);
          setNewLineCost(product.buyPrice);
          setIsNewLineCostManuallyEdited(false);
          setQuickAddOpen(false);
          setQuickAddBarcode("");
        }}
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
        <div className="rounded-xl border border-border-default bg-surface-soft/60 px-4 py-3">
          <SummaryRow
            label={t("purchases.supplier")}
            value={watchedSupplierName || watchedSupplierPhone || t("purchases.walkInSupplier")}
          />
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
          {actualChangeAmount > 0.001 && (
            <SummaryRow
              label={t("purchases.changeDueBack")}
              value={formatCurrency(actualChangeAmount, currency)}
            />
          )}
          {amountDue > 0.001 && (
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
            const phoneNeedle = normalizePhone(supplierSearch);
            const filtered = (suppliers ?? [])
              .filter((s) => {
                if (!needle && !phoneNeedle) return true;
                const nameMatches = s.name.toLowerCase().includes(needle);
                const phoneMatches = Boolean(
                  phoneNeedle &&
                    ((s.normalizedPhone ?? normalizePhone(s.phone)).includes(phoneNeedle)),
                );
                return nameMatches || phoneMatches;
              })
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
          <details className="group rounded-2xl border border-border-subtle bg-surface-soft/70 p-3 open:bg-warning-soft/30">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning">
                  <UserPlus size={16} aria-hidden />
                </span>
                {t("purchases.enterManually")}
              </span>
              <span className="text-lg leading-none text-slate-400 transition-transform group-open:rotate-90">›</span>
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-xs leading-5 text-slate-500">
                {t("purchases.manualSupplierHint")}
              </p>
              <Input
                type="text"
                placeholder={t("purchases.supplierName")}
                aria-label={t("purchases.supplierName")}
                value={manualSupplierName}
                onChange={(e) => setManualSupplierName(e.target.value)}
                inputSize="lg"
                leftSlot={<Store size={17} aria-hidden />}
                className="[font-size:16px]"
                autoComplete="organization"
              />
              <Input
                type="tel"
                inputMode="tel"
                placeholder={t("purchases.supplierPhone")}
                aria-label={t("purchases.supplierPhone")}
                value={manualSupplierPhone}
                onChange={(e) => setManualSupplierPhone(e.target.value)}
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
                    setSupplierSheetOpen(false);
                    setSupplierSearch("");
                  }}
                  disabled={isSavingSupplier}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  fullWidth
                  onClick={saveManualSupplier}
                  disabled={!canSaveManualSupplier}
                  loading={isSavingSupplier}
                >
                  {t("purchases.saveSupplier")}
                </Button>
              </div>
            </div>
          </details>
        </div>
      </Modal>
    </>
  );
}

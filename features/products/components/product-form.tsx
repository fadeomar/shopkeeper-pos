"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { productSchema, type ProductSchema } from "@/features/products/schema";
import { productRepo, settingsRepo } from "@/lib/db/repositories";
import {
  createProductWithInitialMovement,
  updateProductDetails,
} from "@/lib/services/inventory-service";
import { createId } from "@/lib/utils/id";
import { localDateKey } from "@/lib/utils/date";
import { normalizeBarcode } from "@/lib/utils/barcode";
import { gramsToKg, kgToGrams } from "@/lib/utils/weight";
import { db } from "@/lib/db/schema";
import {
  buildProductUnit,
  saveMultiUnitProductWithUnits,
} from "@/lib/services/product-unit-service";
import {
  PHARMACY_UNIT_TEMPLATE,
  SUPERMARKET_UNIT_TEMPLATE,
  type UnitTemplateRow,
  looksLikePharmacy,
  validateUnitDrafts,
} from "@/lib/utils/multi-unit";
import { getServiceErrorMessage } from "@/lib/errors/get-error-message";
import { Plus, Trash2 } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberFieldRHF } from "@/components/ui/number-field-rhf";
import { NumberField } from "@/components/ui/number-field";
import { MoneyInputRHF, MoneyInput } from "@/components/ui/money-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/components/ui/toast";
import { BarcodeScannerModal } from "@/components/barcode/barcode-scanner-modal";
import { useLocale } from "@/components/providers/locale-context";
import { usePermissions } from "@/lib/hooks/use-permissions";
import type { Product, ProductUnit, Settings } from "@/types/domain";
import clsx from "clsx";

interface Props {
  product?: Product;
  onSaved?: (savedProduct?: Product) => void;
  onCancel?: () => void;
  onOpenExisting?: (product: Product) => void;
}

const PRODUCT_DEFAULTS_STORAGE_KEY = "shopkeeper-product-form-defaults-v1";

type StoredProductDefaults = {
  category?: string;
  unit?: string;
};

function getStoredProductDefaults(): StoredProductDefaults {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PRODUCT_DEFAULTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredProductDefaults;
    return {
      category: parsed.category?.trim() || undefined,
      unit: parsed.unit?.trim() || undefined,
    };
  } catch {
    return {};
  }
}

function rememberProductDefaults(values: ProductSchema) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PRODUCT_DEFAULTS_STORAGE_KEY,
      JSON.stringify({
        category: values.category.trim() || undefined,
        unit: values.unit.trim() || undefined,
      } satisfies StoredProductDefaults),
    );
  } catch {
    // localStorage can be unavailable in private mode. Defaults are a UX bonus.
  }
}

function buildEmptyDefaults(settings?: Settings): ProductSchema {
  const stored = getStoredProductDefaults();
  return {
    barcode: "",
    name: "",
    category: stored.category ?? "General",
    brand: "",
    unit: stored.unit ?? "pcs",
    saleType: "unit",
    quantityInStock: 0,
    buyPrice: 0,
    sellPrice: 0,
    minimumStockAlert: Math.max(
      0,
      Math.trunc(settings?.lowStockThreshold ?? 0),
    ),
    supplierName: "",
    dateAdded: localDateKey(),
    expiryDate: "",
    shelfLocation: "",
    notes: "",
    status: "active",
  };
}

/**
 * Map a stored Product into editable form values. Weight products store stock
 * and threshold in grams but are edited in kilograms, so convert those two
 * fields for display; prices are already per-kg.
 */
function productToFormValues(product: Product): ProductSchema {
  const isWeight = product.saleType === "weight";
  return {
    barcode: product.barcode,
    name: product.name,
    category: product.category,
    brand: product.brand ?? "",
    unit: product.unit,
    saleType: isWeight
      ? "weight"
      : product.saleType === "multi_unit"
        ? "multi_unit"
        : "unit",
    quantityInStock: isWeight ? gramsToKg(product.quantityInStock) : product.quantityInStock,
    buyPrice: product.buyPrice,
    sellPrice: product.sellPrice,
    minimumStockAlert: isWeight ? gramsToKg(product.minimumStockAlert) : product.minimumStockAlert,
    supplierName: product.supplierName ?? "",
    dateAdded: product.dateAdded,
    expiryDate: product.expiryDate ?? "",
    shelfLocation: product.shelfLocation ?? "",
    notes: product.notes ?? "",
    status: product.status,
  };
}

/** A single editable unit row in the multi-unit product form. */
type UnitRow = {
  id?: string; // present when the unit already exists (locks conversion edits)
  name: string;
  conversionToBase: number;
  sellPrice: number;
  buyPrice: number;
  barcode: string;
  canSell: boolean;
  canPurchase: boolean;
  isDefaultSaleUnit: boolean;
  persisted: boolean;
};

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {error && (
        <span className="text-xs text-danger font-medium">{error}</span>
      )}
    </label>
  );
}

export function ProductForm({ product, onSaved, onCancel, onOpenExisting }: Props) {
  const { t } = useLocale();
  const { push } = useToast();
  const { canEditCost } = usePermissions();
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const products = useLiveQuery(() => productRepo.list(), []);
  const allProductUnits = useLiveQuery(() => db.productUnits.toArray(), []);
  const currency = settings?.currency ?? "ILS";
  const [lossWarning, setLossWarning] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  const form = useForm<ProductSchema>({
    resolver: zodResolver(productSchema),
    defaultValues: product ? productToFormValues(product) : buildEmptyDefaults(settings),
  });

  const saleType = form.watch("saleType");
  const isWeight = saleType === "weight";
  const isMulti = saleType === "multi_unit";

  // Multi-unit editor state. Units live outside react-hook-form (they're a
  // dynamic table with their own validation) and are persisted via
  // saveProductUnits on submit.
  const [units, setUnits] = useState<UnitRow[]>([]);
  const unitsInitRef = useRef(false);
  const existingUnits = useLiveQuery(
    () =>
      product?.id
        ? db.productUnits.where("productId").equals(product.id).toArray()
        : Promise.resolve<ProductUnit[]>([]),
    [product?.id],
  );

  // If the form is reused for a different product, allow the units to reload.
  useEffect(() => {
    unitsInitRef.current = false;
    setUnits([]);
  }, [product?.id]);

  // Seed the editor from stored units when editing an existing multi-unit
  // product (once, so it doesn't clobber in-progress edits).
  useEffect(() => {
    if (!product || unitsInitRef.current) return;
    if (product.saleType !== "multi_unit" || !existingUnits) return;
    setUnits(
      existingUnits
        .slice()
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder || a.conversionToBase - b.conversionToBase,
        )
        .map((u) => ({
          id: u.id,
          name: u.name,
          conversionToBase: u.conversionToBase,
          sellPrice: u.sellPrice,
          buyPrice: u.buyPrice ?? 0,
          barcode: u.barcode ?? "",
          canSell: u.canSell,
          canPurchase: u.canPurchase,
          isDefaultSaleUnit: Boolean(u.isDefaultSaleUnit),
          persisted: true,
        })),
    );
    unitsInitRef.current = true;
  }, [product, existingUnits]);

  function applyUnitTemplate(template: UnitTemplateRow[]) {
    setUnits(
      template.map((row) => ({
        name: t(`multiUnit.${row.nameKey}`),
        conversionToBase: row.conversionToBase,
        sellPrice: 0,
        buyPrice: 0,
        barcode: "",
        canSell: row.canSell,
        canPurchase: row.canPurchase,
        isDefaultSaleUnit: row.isDefaultSaleUnit,
        persisted: false,
      })),
    );
  }

  function selectMultiUnit() {
    form.setValue("saleType", "multi_unit", { shouldDirty: true });
    if (units.length === 0) {
      applyUnitTemplate(
        looksLikePharmacy(form.getValues("category"))
          ? PHARMACY_UNIT_TEMPLATE
          : SUPERMARKET_UNIT_TEMPLATE,
      );
    }
  }

  function updateUnit(index: number, patch: Partial<UnitRow>) {
    setUnits((cur) => cur.map((u, i) => (i === index ? { ...u, ...patch } : u)));
  }

  function setDefaultUnit(index: number) {
    setUnits((cur) =>
      cur.map((u, i) => ({ ...u, isDefaultSaleUnit: i === index })),
    );
  }

  function addUnitRow() {
    setUnits((cur) => [
      ...cur,
      {
        name: "",
        conversionToBase: 1,
        sellPrice: 0,
        buyPrice: 0,
        barcode: "",
        canSell: true,
        canPurchase: false,
        isDefaultSaleUnit: cur.length === 0,
        persisted: false,
      },
    ]);
  }

  function removeUnitRow(index: number) {
    setUnits((cur) => {
      const next = cur.filter((_, i) => i !== index);
      // Keep exactly one default among the remaining sellable rows.
      if (next.length > 0 && !next.some((u) => u.isDefaultSaleUnit)) {
        const firstSellable = next.findIndex((u) => u.canSell);
        const target = firstSellable >= 0 ? firstSellable : 0;
        next[target] = { ...next[target], isDefaultSaleUnit: true };
      }
      return next;
    });
  }
  const sellPrice = form.watch("sellPrice");
  const buyPrice = form.watch("buyPrice");
  const watchedBarcode = form.watch("barcode");
  const duplicateBarcodeProduct = useMemo(() => {
    const normalized = normalizeBarcode(watchedBarcode);
    if (normalized.length < 3) return undefined;
    return (products ?? []).find(
      (candidate) =>
        normalizeBarcode(candidate.barcode) === normalized &&
        candidate.id !== product?.id,
    );
  }, [products, product?.id, watchedBarcode]);

  // Editing and add-mode defaults have different reset lifecycles. Keeping
  // `isDirty` in the same effect as an existing product caused the form to
  // reset back to the stored values after the cashier's first keystroke. The
  // keyed ProductForm mount supplies the initial edit values; this effect only
  // rehydrates when the selected product object itself changes.
  useEffect(() => {
    if (!product) return;
    form.reset(productToFormValues(product));
  }, [form, product]);

  // Settings may arrive after the empty add form mounts. Apply those defaults
  // only while the cashier has not started typing, and never while editing.
  useEffect(() => {
    if (product || form.formState.isDirty) return;
    form.reset(buildEmptyDefaults(settings));
  }, [form, product, settings, form.formState.isDirty]);
  useEffect(() => {
    setLossWarning(Number(sellPrice) < Number(buyPrice));
  }, [sellPrice, buyPrice]);

  const UNIT_ISSUE_KEY: Record<string, string> = {
    no_units: "multiUnit.errUnits",
    no_sellable: "multiUnit.errSellable",
    no_default: "multiUnit.errDefault",
    multiple_default: "multiUnit.errMultipleDefault",
    no_base: "multiUnit.errBase",
    empty_name: "multiUnit.errName",
    bad_conversion: "multiUnit.errConversion",
    duplicate_barcode: "multiUnit.errBarcode",
  };

  async function submitMultiUnit(values: ProductSchema, now: string) {
    const issues = validateUnitDrafts(units);
    if (issues.length > 0) {
      push(t(UNIT_ISSUE_KEY[issues[0].code] ?? "multiUnit.errUnits"), "error");
      return;
    }

    // Product/unit barcodes share one scanner namespace. Prevent ambiguous
    // scans before the service-layer guard runs.
    const productOwnBarcode = normalizeBarcode(values.barcode);
    const otherProductBarcodes = new Set(
      (products ?? [])
        .filter((p) => p.id !== product?.id)
        .map((p) => normalizeBarcode(p.barcode)),
    );
    const otherUnitBarcodes = new Set(
      (allProductUnits ?? [])
        .filter((u) => u.productId !== product?.id && u.id)
        .map((u) => normalizeBarcode(u.barcode ?? ""))
        .filter(Boolean),
    );
    for (const row of units) {
      const bc = normalizeBarcode(row.barcode || "");
      if (!bc) continue;
      if (bc === productOwnBarcode || otherProductBarcodes.has(bc) || otherUnitBarcodes.has(bc)) {
        push(t("products.barcodeUnique"), "error");
        return;
      }
    }

    const productId = product?.id ?? createId("prod");
    const built = units.map((row, i) =>
      buildProductUnit(
        productId,
        {
          id: row.id,
          name: row.name,
          conversionToBase: row.conversionToBase,
          sellPrice: row.sellPrice,
          buyPrice: canEditCost ? row.buyPrice : undefined,
          barcode: row.barcode || undefined,
          canSell: row.canSell,
          canPurchase: row.canPurchase,
          isDefaultSaleUnit: row.isDefaultSaleUnit,
        },
        i,
        now,
      ),
    );
    const baseUnit = built.find((u) => u.conversionToBase === 1) ?? built[0];
    const defaultUnit = built.find((u) => u.isDefaultSaleUnit) ?? baseUnit;

    if (!product && values.quantityInStock > 0 && canEditCost && (baseUnit.buyPrice ?? 0) <= 0) {
      push(t("multiUnit.errOpeningCost"), "error");
      return;
    }

    try {
      if (product) {
        const changes: Partial<Product> = {
          ...values,
          saleType: "multi_unit",
          defaultSaleUnitId: defaultUnit.id,
          unit: baseUnit.name,
          sellPrice: baseUnit.sellPrice,
          // Stock changes only ever go through stock-movement services.
          quantityInStock: product.quantityInStock,
          minimumStockAlert: values.minimumStockAlert,
          lastUpdated: now,
        };
        if (canEditCost) changes.buyPrice = baseUnit.buyPrice ?? 0;
        else delete changes.buyPrice;
        // Single atomic write: product + units reconcile in one transaction so a
        // unit failure can't leave the product half-updated.
        await saveMultiUnitProductWithUnits({
          mode: "update",
          product,
          changes,
          units: built,
        });
        const savedProduct = await productRepo.findById(product.id);
        if (savedProduct) {
          form.reset(productToFormValues(savedProduct));
        }
        push(t("products.productUpdated"));
        onSaved?.(savedProduct);
        return;
      } else {
        const created: Product = {
          id: productId,
          ...values,
          saleType: "multi_unit",
          defaultSaleUnitId: defaultUnit.id,
          unit: baseUnit.name,
          quantityInStock: values.quantityInStock,
          minimumStockAlert: values.minimumStockAlert,
          sellPrice: baseUnit.sellPrice,
          buyPrice: canEditCost ? baseUnit.buyPrice ?? 0 : 0,
          lastUpdated: now,
          syncStatus: "pending",
        };
        // Single atomic write: product + opening stock/lot + units in one
        // transaction so a unit failure can't leave a multi_unit product with
        // no valid units.
        await saveMultiUnitProductWithUnits({
          mode: "create",
          product: created,
          units: built,
        });
        rememberProductDefaults(values);
        form.reset(buildEmptyDefaults(settings));
        setUnits([]);
        unitsInitRef.current = false;
        push(t("products.productCreated"));
        onSaved?.();
      }
    } catch (error) {
      push(getServiceErrorMessage(error, t, t("products.productUpdated")), "error");
    }
  }

  async function onSubmit(values: ProductSchema) {
    const existing = await productRepo.findByBarcode(values.barcode);
    if (existing && existing.id !== product?.id) {
      form.setError("barcode", {
        message: t("products.barcodeAlreadyUsed", {
          name: existing.name,
        }),
      });
      push(t("products.barcodeUnique"), "error");
      return;
    }
    // The product barcode shares the scanner namespace with product-unit
    // barcodes — block a collision with another product's unit (service guards
    // too). Covers every sale type since onSubmit runs before submitMultiUnit.
    const productBarcode = normalizeBarcode(values.barcode);
    const unitClash = (allProductUnits ?? []).find(
      (u) =>
        u.productId !== product?.id &&
        normalizeBarcode(u.barcode ?? "") === productBarcode,
    );
    if (unitClash) {
      form.setError("barcode", { message: t("products.barcodeUnique") });
      push(t("products.barcodeUnique"), "error");
      return;
    }
    const now = new Date().toISOString();

    // ── Multi-unit products ────────────────────────────────────────────────
    if (values.saleType === "multi_unit") {
      await submitMultiUnit(values, now);
      return;
    }

    const valueIsWeight = values.saleType === "weight";
    // Weight stock/threshold are entered in kg; persist them as integer grams.
    // Prices stay per-kg. Stored saleType drives all downstream weight math.
    const minimumStockAlertBase = valueIsWeight
      ? kgToGrams(values.minimumStockAlert)
      : values.minimumStockAlert;
    if (product) {
      const changes: Partial<Product> = {
        ...values,
        // saleType can't be flipped on an existing product (the selector is
        // locked on edit) — keep the stored one so stock/lots stay consistent.
        saleType: product.saleType,
        quantityInStock: product.quantityInStock,
        minimumStockAlert: minimumStockAlertBase,
        lastUpdated: now,
      };
      // Without cost permission, never send buyPrice — this guarantees an edit
      // can't blank out (or alter) the existing cost. The service also guards.
      if (!canEditCost) delete changes.buyPrice;
      await updateProductDetails(product, changes);
      // Re-read the row we actually persisted and keep edit mode open. This
      // prevents a successful edit from immediately looking like its prices
      // were reset to zero when the parent switches back to the blank Add
      // Product form, and it makes the form reflect IndexedDB as the source of
      // truth after every save.
      const savedProduct = await productRepo.findById(product.id);
      if (savedProduct) {
        form.reset(productToFormValues(savedProduct));
      }
      push(t("products.productUpdated"));
      onSaved?.(savedProduct);
      return;
    } else {
      const created: Product = {
        id: createId("prod"),
        ...values,
        saleType: valueIsWeight ? "weight" : "unit",
        quantityInStock: valueIsWeight ? kgToGrams(values.quantityInStock) : values.quantityInStock,
        minimumStockAlert: minimumStockAlertBase,
        // Cost is permission-gated; non-privileged roles create with 0 cost.
        // The service enforces this too, so this is just an explicit mirror.
        buyPrice: canEditCost ? values.buyPrice : 0,
        lastUpdated: now,
        syncStatus: "pending",
      };
      await createProductWithInitialMovement(created);
      rememberProductDefaults(values);
      form.reset(buildEmptyDefaults(settings));
      push(t("products.productCreated"));
      onSaved?.();
    }
  }

  const e = form.formState.errors;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2 flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">
            {t("weight.sellingMethod")}
          </span>
          <div
            className="flex gap-2"
            role="group"
            aria-label={t("weight.sellingMethod")}
          >
            <Button
              type="button"
              variant={!isWeight && !isMulti ? "primary" : "secondary"}
              aria-pressed={!isWeight && !isMulti}
              disabled={Boolean(product)}
              className="flex-1"
              onClick={() => {
                form.setValue("saleType", "unit", { shouldDirty: true });
                form.setValue("unit", "pcs", { shouldDirty: true });
              }}
            >
              {t("weight.piece")}
            </Button>
            <Button
              type="button"
              variant={isWeight ? "primary" : "secondary"}
              aria-pressed={isWeight}
              disabled={Boolean(product)}
              className="flex-1"
              onClick={() => {
                form.setValue("saleType", "weight", { shouldDirty: true });
                form.setValue("unit", "kg", { shouldDirty: true });
              }}
            >
              {t("weight.weight")}
            </Button>
            <Button
              type="button"
              variant={isMulti ? "primary" : "secondary"}
              aria-pressed={isMulti}
              disabled={Boolean(product)}
              className="flex-1"
              onClick={selectMultiUnit}
            >
              {t("multiUnit.label")}
            </Button>
          </div>
          {isWeight && (
            <span className="text-xs text-slate-500">{t("weight.deductHelp")}</span>
          )}
          {isMulti && (
            <span className="text-xs text-slate-500">
              {t("multiUnit.deductHelp", {
                base: form.watch("unit") || t("multiUnit.baseUnit"),
              })}
            </span>
          )}
        </div>

        <FormField label={t("products.name")} error={e.name?.message}>
          <Input {...form.register("name")} />
        </FormField>

        <FormField label={t("products.barcode")} error={e.barcode?.message}>
          <div className="flex gap-2">
            <Input {...form.register("barcode")} className="flex-1" />
            <Button
              type="button"
              variant="secondary"
              onClick={() => setScannerOpen(true)}
            >
              {t("common.scan")}
            </Button>
          </div>
          {duplicateBarcodeProduct && (
            <div className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
              <p className="font-medium">
                {t("products.barcodeAlreadyUsed", {
                  name: duplicateBarcodeProduct.name,
                })}
              </p>
              {onOpenExisting && (
                <button
                  type="button"
                  className="mt-1 font-semibold underline underline-offset-2"
                  onClick={() => onOpenExisting(duplicateBarcodeProduct)}
                >
                  {t("products.openExistingProductInstead")}
                </button>
              )}
            </div>
          )}
        </FormField>

        <FormField label={t("products.category")}>
          <Input {...form.register("category")} />
        </FormField>

        <FormField label={t("products.brand")}>
          <Input {...form.register("brand")} />
        </FormField>

        {!isWeight && (
          <FormField label={isMulti ? t("multiUnit.baseUnitName") : t("products.unit")}>
            <Input {...form.register("unit")} />
          </FormField>
        )}

        <FormField
          label={isWeight ? t("weight.currentStockKg") : t("products.quantityInStock")}
          error={product ? t("products.stockEditNote") : undefined}
        >
          <NumberFieldRHF
            name="quantityInStock"
            control={form.control}
            precision={isWeight ? "decimal" : "integer"}
            min={0}
            disabled={Boolean(product)}
            className={clsx(Boolean(product) && "opacity-50")}
          />
        </FormField>

        {/* Multi-unit prices live on each unit row below, not here. */}
        {!isMulti &&
          (canEditCost ? (
            <FormField label={isWeight ? t("weight.costPerKg") : t("products.buyPrice")}>
              <MoneyInputRHF
                name="buyPrice"
                control={form.control}
                currency={currency}
                min={0}
              />
            </FormField>
          ) : (
            // Cost is hidden for roles without canEditCost, but we surface a clear
            // note so creating a product without a cost is an explicit, visible
            // outcome rather than a silent buyPrice = 0.
            <FormField label={isWeight ? t("weight.costPerKg") : t("products.buyPrice")}>
              <div className="flex min-h-11 items-center rounded-xl bg-slate-50 border border-slate-100 px-3 text-xs text-slate-500">
                {t("products.buyPriceLocked")}
              </div>
            </FormField>
          ))}

        {!isMulti && (
          <FormField
            label={isWeight ? t("weight.sellPricePerKg") : t("products.sellPrice")}
            error={e.sellPrice?.message}
          >
            <MoneyInputRHF
              name="sellPrice"
              control={form.control}
              currency={currency}
              min={0}
            />
          </FormField>
        )}

        <FormField
          label={isWeight ? t("weight.lowStockKg") : t("products.minimumStockAlert")}
          error={e.minimumStockAlert?.message}
        >
          <NumberFieldRHF
            name="minimumStockAlert"
            control={form.control}
            precision={isWeight ? "decimal" : "integer"}
            min={0}
          />
        </FormField>

        <FormField label={t("products.supplierName")}>
          <Input {...form.register("supplierName")} />
        </FormField>

        <FormField label={t("products.dateAdded")}>
          <Input type="date" {...form.register("dateAdded")} />
        </FormField>

        <FormField label={t("products.expiryDate")}>
          <Input type="date" {...form.register("expiryDate")} />
        </FormField>

        <FormField label={t("products.shelfLocation")}>
          <Input {...form.register("shelfLocation")} />
        </FormField>

        <FormField label={t("products.status")}>
          <SearchableSelect
            value={form.watch("status")}
            onValueChange={(value) =>
              form.setValue(
                "status",
                (value ?? "active") as "active" | "inactive",
              )
            }
            placeholder={t("products.status")}
            searchPlaceholder={t("common.search")}
            options={[
              { value: "active", label: t("common.active") },
              { value: "inactive", label: t("common.inactive") },
            ]}
          />
        </FormField>

        <FormField label={t("products.notes")}>
          <Input {...form.register("notes")} />
        </FormField>
      </div>

      {/* Multi-unit editor — compact card, only for multi_unit products */}
      {isMulti && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border-default bg-surface-soft/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-800">
              {t("multiUnit.units")}
            </h4>
          </div>

          {/* Quick templates — disabled when editing so they can't wipe units */}
          {!product && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">{t("multiUnit.template")}:</span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => applyUnitTemplate(PHARMACY_UNIT_TEMPLATE)}
              >
                {t("multiUnit.templatePharmacy")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => applyUnitTemplate(SUPERMARKET_UNIT_TEMPLATE)}
              >
                {t("multiUnit.templateSupermarket")}
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {units.map((u, index) => (
              <div
                key={u.id ?? `new-${index}`}
                className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 rounded-xl border border-border-subtle bg-surface p-3"
              >
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">{t("multiUnit.unitName")}</span>
                    <Input
                      value={u.name}
                      onChange={(ev) => updateUnit(index, { name: ev.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">{t("multiUnit.conversion")}</span>
                    <NumberField
                      value={u.conversionToBase}
                      onValueChange={(v) => updateUnit(index, { conversionToBase: v })}
                      precision="integer"
                      min={1}
                      disabled={u.persisted}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">{t("multiUnit.sellPrice")}</span>
                    <MoneyInput
                      value={u.sellPrice}
                      onValueChange={(v) => updateUnit(index, { sellPrice: v })}
                      currency={currency}
                      min={0}
                    />
                  </label>
                  {canEditCost && (
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-slate-500">{t("multiUnit.buyPrice")}</span>
                      <MoneyInput
                        value={u.buyPrice}
                        onValueChange={(v) => updateUnit(index, { buyPrice: v })}
                        currency={currency}
                        min={0}
                      />
                    </label>
                  )}
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">{t("multiUnit.barcode")}</span>
                    <Input
                      value={u.barcode}
                      onChange={(ev) => updateUnit(index, { barcode: ev.target.value })}
                    />
                  </label>
                </div>
                <div className="flex flex-row sm:flex-col items-start justify-between gap-2">
                  <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={u.canSell}
                        onChange={(ev) => updateUnit(index, { canSell: ev.target.checked })}
                      />
                      {t("multiUnit.canSell")}
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={u.canPurchase}
                        onChange={(ev) => updateUnit(index, { canPurchase: ev.target.checked })}
                      />
                      {t("multiUnit.canPurchase")}
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="defaultSaleUnit"
                        checked={u.isDefaultSaleUnit}
                        onChange={() => setDefaultUnit(index)}
                      />
                      {t("multiUnit.defaultUnit")}
                    </label>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeUnitRow(index)}
                    aria-label={t("multiUnit.removeUnit")}
                  >
                    <Trash2 size={16} aria-hidden />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={addUnitRow}
            className="self-start inline-flex items-center gap-1.5"
          >
            <Plus size={16} aria-hidden />
            {t("multiUnit.addUnit")}
          </Button>
        </div>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between gap-4 pt-2 border-t border-slate-100">
        <p
          className={clsx(
            "text-sm",
            lossWarning ? "text-warning font-semibold" : "text-slate-400",
          )}
        >
          {lossWarning ? t("products.lossWarning") : t("products.editNote")}
        </p>
        <div className="flex items-center gap-2">
          {product && onCancel && (
            <Button type="button" variant="secondary" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
          )}
          <Button type="submit">
            {product ? t("products.saveProduct") : t("products.addProduct")}
          </Button>
        </div>
      </div>

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        title={t("products.scanBarcode")}
        description={t("products.scanBarcodeDesc")}
        onDetected={(barcode) => {
          form.setValue("barcode", barcode, {
            shouldDirty: true,
            shouldValidate: true,
          });
          setScannerOpen(false);
        }}
      />
    </form>
  );
}

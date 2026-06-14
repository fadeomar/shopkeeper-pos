"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLiveQuery } from "dexie-react-hooks";
import { productSchema, type ProductSchema } from "@/features/products/schema";
import { productRepo, settingsRepo } from "@/lib/db/repositories";
import { createProductWithInitialMovement } from "@/lib/services/inventory-service";
import { createId } from "@/lib/utils/id";
import { localDateKey } from "@/lib/utils/date";
import { normalizeBarcode } from "@/lib/utils/barcode";
import { kgToGrams } from "@/lib/utils/weight";
import { getServiceErrorMessage } from "@/lib/errors/get-error-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import { NumberFieldRHF } from "@/components/ui/number-field-rhf";
import { MoneyInputRHF } from "@/components/ui/money-input";
import { Modal } from "@/components/ui/modal";
import { QuantityStepper } from "@/components/pos/quantity-stepper";
import { useLocale } from "@/components/providers/locale-context";
import { useToast } from "@/components/ui/toast";
import type { Product, Settings } from "@/types/domain";

interface Props {
  open: boolean;
  barcode: string;
  currency: string;
  defaultQuantity: number;
  supplierName?: string;
  onClose: () => void;
  onCreated: (product: Product, quantity: number) => void;
  onUseExisting: (product: Product) => void;
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
    // Defaults are a convenience only.
  }
}

function buildDefaults(input: {
  barcode: string;
  settings?: Settings;
  supplierName?: string;
}): ProductSchema {
  const stored = getStoredProductDefaults();
  return {
    barcode: normalizeBarcode(input.barcode),
    name: "",
    category: stored.category ?? "General",
    brand: "",
    saleType: "unit",
    unit: stored.unit ?? "pcs",
    quantityInStock: 0,
    buyPrice: 0,
    sellPrice: 0,
    minimumStockAlert: Math.max(
      0,
      Math.trunc(input.settings?.lowStockThreshold ?? 0),
    ),
    supplierName: input.supplierName?.trim() ?? "",
    dateAdded: localDateKey(),
    expiryDate: "",
    shelfLocation: "",
    notes: "",
    status: "active",
  };
}

function Field({
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
        <span className="text-xs font-medium text-danger">{error}</span>
      )}
    </label>
  );
}

export function PurchaseQuickProductModal({
  open,
  barcode,
  currency,
  defaultQuantity,
  supplierName,
  onClose,
  onCreated,
  onUseExisting,
}: Props) {
  const { t } = useLocale();
  const { push } = useToast();
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const products = useLiveQuery(() => productRepo.list(), []);
  const [saving, setSaving] = useState(false);
  const [purchaseQuantity, setPurchaseQuantity] = useState(1);

  const form = useForm<ProductSchema>({
    resolver: zodResolver(productSchema),
    defaultValues: buildDefaults({ barcode, settings, supplierName }),
  });

  const watchedBarcode = form.watch("barcode");
  const watchedBuyPrice = Number(form.watch("buyPrice") || 0);
  const watchedSellPrice = Number(form.watch("sellPrice") || 0);
  const duplicateBarcodeProduct = useMemo(() => {
    const normalized = normalizeBarcode(watchedBarcode);
    if (normalized.length < 3) return undefined;
    return (products ?? []).find(
      (candidate) => normalizeBarcode(candidate.barcode) === normalized,
    );
  }, [products, watchedBarcode]);
  const lowMargin = watchedSellPrice > 0 && watchedBuyPrice >= watchedSellPrice;
  const isWeight = form.watch("saleType") === "weight";

  useEffect(() => {
    if (!open) return;
    setPurchaseQuantity(Math.max(1, Math.trunc(defaultQuantity || 1)));
    form.reset(buildDefaults({ barcode, settings, supplierName }));
  }, [barcode, defaultQuantity, form, open, settings, supplierName]);

  async function submit(values: ProductSchema) {
    if (duplicateBarcodeProduct) {
      form.setError("barcode", {
        message: t("products.barcodeAlreadyUsed", {
          name: duplicateBarcodeProduct.name,
        }),
      });
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const valueIsWeight = values.saleType === "weight";
      const product: Product = {
        id: createId("prod"),
        ...values,
        saleType: valueIsWeight ? "weight" : "unit",
        // Initial stock is always 0 here — the purchase movement adds it.
        quantityInStock: 0,
        // Weight thresholds are entered in kg but persisted as integer grams,
        // matching the main product form. Prices stay per-kg.
        minimumStockAlert: valueIsWeight
          ? kgToGrams(values.minimumStockAlert)
          : values.minimumStockAlert,
        lastUpdated: now,
        syncStatus: "pending",
      };

      await createProductWithInitialMovement(product);
      rememberProductDefaults(values);
      // Weight buys fractional kilograms; pieces buy whole units.
      const purchaseQty = valueIsWeight
        ? Math.max(0, purchaseQuantity || 0)
        : Math.max(1, Math.trunc(purchaseQuantity || 1));
      onCreated(product, purchaseQty);
      form.reset(buildDefaults({ barcode: "", settings, supplierName: "" }));
    } catch (error) {
      push(
        getServiceErrorMessage(error, t, t("purchases.quickAddFailed")),
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  const errors = form.formState.errors;

  return (
    <Modal
      open={open}
      title={t("purchases.quickAddProduct")}
      description={
        barcode
          ? t("purchases.quickAddProductDescWithBarcode", { barcode })
          : t("purchases.quickAddProductDesc")
      }
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={form.handleSubmit(submit)}
            disabled={saving || Boolean(duplicateBarcodeProduct)}
          >
            {saving ? t("common.loading") : t("purchases.saveAndAddToPurchase")}
          </Button>
        </>
      }
    >
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={form.handleSubmit(submit)}
      >
        {/* Selling method: lets a weight product (e.g. sugar by kg) be created
            inline during a purchase. Mirrors the main product form. */}
        <div className="sm:col-span-2 flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">
            {t("weight.sellingMethod")}
          </span>
          <div className="flex gap-2" role="group" aria-label={t("weight.sellingMethod")}>
            <Button
              type="button"
              variant={isWeight ? "secondary" : "primary"}
              aria-pressed={!isWeight}
              className="flex-1"
              onClick={() => {
                form.setValue("saleType", "unit", { shouldDirty: true });
                form.setValue("unit", "pcs", { shouldDirty: true });
                setPurchaseQuantity((q) => Math.max(1, Math.trunc(q || 1)));
              }}
            >
              {t("weight.piece")}
            </Button>
            <Button
              type="button"
              variant={isWeight ? "primary" : "secondary"}
              aria-pressed={isWeight}
              className="flex-1"
              onClick={() => {
                form.setValue("saleType", "weight", { shouldDirty: true });
                form.setValue("unit", "kg", { shouldDirty: true });
              }}
            >
              {t("weight.weight")}
            </Button>
          </div>
          {isWeight && (
            <span className="text-xs text-slate-500">{t("weight.deductHelp")}</span>
          )}
        </div>

        <Field label={t("products.name")} error={errors.name?.message}>
          <Input autoFocus {...form.register("name")} />
        </Field>
        <Field label={t("products.barcode")} error={errors.barcode?.message}>
          <Input {...form.register("barcode")} />
          {duplicateBarcodeProduct && (
            <div className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
              <p className="font-medium">
                {t("products.barcodeAlreadyUsed", {
                  name: duplicateBarcodeProduct.name,
                })}
              </p>
              <button
                type="button"
                className="mt-1 font-semibold underline underline-offset-2"
                onClick={() => onUseExisting(duplicateBarcodeProduct)}
              >
                {t("products.openExistingProductInstead")}
              </button>
            </div>
          )}
        </Field>

        <Field label={isWeight ? t("weight.purchaseQtyKg") : t("purchases.purchaseQuantity")}>
          {isWeight ? (
            <NumberField
              value={purchaseQuantity}
              onValueChange={setPurchaseQuantity}
              precision="decimal"
              min={0}
            />
          ) : (
            <QuantityStepper
              value={purchaseQuantity}
              onChange={setPurchaseQuantity}
              min={1}
            />
          )}
        </Field>
        <Field label={isWeight ? t("weight.costPerKg") : t("products.buyPrice")} error={errors.buyPrice?.message}>
          <MoneyInputRHF
            name="buyPrice"
            control={form.control}
            currency={currency}
            min={0}
          />
        </Field>

        <Field label={isWeight ? t("weight.sellPricePerKg") : t("products.sellPrice")} error={errors.sellPrice?.message}>
          <MoneyInputRHF
            name="sellPrice"
            control={form.control}
            currency={currency}
            min={0}
          />
          {lowMargin && (
            <span className="text-xs font-medium text-warning">
              {t("purchases.lowMarginWarning")}
            </span>
          )}
        </Field>
        <Field label={t("products.category")} error={errors.category?.message}>
          <Input {...form.register("category")} />
        </Field>

        <Field label={t("products.brand")} error={errors.brand?.message}>
          <Input {...form.register("brand")} />
        </Field>
        <Field label={t("products.unit")} error={errors.unit?.message}>
          <Input {...form.register("unit")} />
        </Field>

        <Field
          label={isWeight ? t("weight.lowStockKg") : t("products.minimumStockAlert")}
          error={errors.minimumStockAlert?.message}
        >
          <NumberFieldRHF
            name="minimumStockAlert"
            control={form.control}
            precision={isWeight ? "decimal" : "integer"}
            min={0}
          />
        </Field>
        <Field label={t("products.supplierName")} error={errors.supplierName?.message}>
          <Input {...form.register("supplierName")} />
        </Field>

        <Field label={t("products.expiryDate")} error={errors.expiryDate?.message}>
          <Input type="date" {...form.register("expiryDate")} />
        </Field>
        <Field label={t("products.shelfLocation")} error={errors.shelfLocation?.message}>
          <Input {...form.register("shelfLocation")} />
        </Field>

        <div className="sm:col-span-2">
          <Field label={t("products.notes")} error={errors.notes?.message}>
            <Input {...form.register("notes")} />
          </Field>
        </div>
        <button type="submit" className="hidden" disabled={saving} />
      </form>
    </Modal>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberFieldRHF } from "@/components/ui/number-field-rhf";
import { MoneyInputRHF } from "@/components/ui/money-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/components/ui/toast";
import { BarcodeScannerModal } from "@/components/barcode/barcode-scanner-modal";
import { useLocale } from "@/components/providers/locale-context";
import { usePermissions } from "@/lib/hooks/use-permissions";
import type { Product, Settings } from "@/types/domain";
import clsx from "clsx";

interface Props {
  product?: Product;
  onSaved?: () => void;
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
  const currency = settings?.currency ?? "ILS";
  const [lossWarning, setLossWarning] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  const form = useForm<ProductSchema>({
    resolver: zodResolver(productSchema),
    defaultValues: product ?? buildEmptyDefaults(settings),
  });

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

  useEffect(() => {
    if (product) {
      form.reset(product);
      return;
    }
    if (!form.formState.isDirty) {
      form.reset(buildEmptyDefaults(settings));
    }
  }, [form, product, settings, form.formState.isDirty]);
  useEffect(() => {
    setLossWarning(Number(sellPrice) < Number(buyPrice));
  }, [sellPrice, buyPrice]);

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
    const now = new Date().toISOString();
    if (product) {
      const changes: Partial<Product> = {
        ...values,
        quantityInStock: product.quantityInStock,
        lastUpdated: now,
      };
      // Without cost permission, never send buyPrice — this guarantees an edit
      // can't blank out (or alter) the existing cost. The service also guards.
      if (!canEditCost) delete changes.buyPrice;
      await updateProductDetails(product, changes);
      push(t("products.productUpdated"));
    } else {
      const created: Product = {
        id: createId("prod"),
        ...values,
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
    }
    onSaved?.();
  }

  const e = form.formState.errors;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        <FormField label={t("products.unit")}>
          <Input {...form.register("unit")} />
        </FormField>

        <FormField
          label={t("products.quantityInStock")}
          error={product ? t("products.stockEditNote") : undefined}
        >
          <NumberFieldRHF
            name="quantityInStock"
            control={form.control}
            precision="integer"
            min={0}
            disabled={Boolean(product)}
            className={clsx(Boolean(product) && "opacity-50")}
          />
        </FormField>

        {canEditCost ? (
          <FormField label={t("products.buyPrice")}>
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
          <FormField label={t("products.buyPrice")}>
            <div className="flex min-h-11 items-center rounded-xl bg-slate-50 border border-slate-100 px-3 text-xs text-slate-500">
              {t("products.buyPriceLocked")}
            </div>
          </FormField>
        )}

        <FormField label={t("products.sellPrice")}>
          <MoneyInputRHF
            name="sellPrice"
            control={form.control}
            currency={currency}
            min={0}
          />
        </FormField>

        <FormField label={t("products.minimumStockAlert")}>
          <NumberFieldRHF
            name="minimumStockAlert"
            control={form.control}
            precision="integer"
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

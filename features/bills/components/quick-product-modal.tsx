"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { productSchema, type ProductSchema } from "@/features/products/schema";
import { productRepo } from "@/lib/db/repositories";
import { createProductWithInitialMovement } from "@/lib/services/inventory-service";
import { createId } from "@/lib/utils/id";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { FormField } from "@/components/ui/form-field";
import { useLocale } from "@/components/providers/locale-context";
import { useToast } from "@/components/ui/toast";
import type { Product } from "@/types/domain";

interface Props {
  open: boolean;
  barcode: string;
  onClose: () => void;
  onCreated: (product: Product) => void;
}

function buildDefaults(barcode: string): ProductSchema {
  return {
    barcode,
    name: "",
    category: "General",
    brand: "",
    unit: "pcs",
    quantityInStock: 1,
    buyPrice: 0,
    sellPrice: 0,
    minimumStockAlert: 0,
    supplierName: "",
    dateAdded: new Date().toISOString().slice(0, 10),
    expiryDate: "",
    shelfLocation: "",
    notes: "",
    status: "active",
  };
}

export function QuickProductModal({
  open,
  barcode,
  onClose,
  onCreated,
}: Props) {
  const { t } = useLocale();
  const { push } = useToast();
  const [saving, setSaving] = useState(false);

  const form = useForm<ProductSchema>({
    resolver: zodResolver(productSchema),
    defaultValues: buildDefaults(barcode),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(buildDefaults(barcode));
  }, [barcode, form, open]);

  async function submit(values: ProductSchema) {
    setSaving(true);
    try {
      const existing = await productRepo.findByBarcode(values.barcode);
      if (existing) {
        form.setError("barcode", { message: t("products.barcodeUnique") });
        return;
      }

      const now = new Date().toISOString();
      const product: Product = {
        id: createId("prod"),
        ...values,
        lastUpdated: now,
        syncStatus: "pending",
      };

      await createProductWithInitialMovement(product);
      onCreated(product);
      form.reset(buildDefaults(""));
    } catch (error) {
      push(
        error instanceof Error ? error.message : t("billing.quickAddFailed"),
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
      title={t("billing.quickAddProduct")}
      description={t("billing.quickAddProductDesc", { barcode })}
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={saving}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={form.handleSubmit(submit)}
            loading={saving}
          >
            {saving ? t("common.loading") : t("billing.saveAndAddToBill")}
          </Button>
        </>
      }
    >
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={form.handleSubmit(submit)}
      >
        <FormField
          label={t("products.barcode")}
          error={errors.barcode?.message}
        >
          <Input
            {...form.register("barcode")}
            error={Boolean(errors.barcode)}
          />
        </FormField>
        <FormField label={t("products.name")} error={errors.name?.message}>
          <Input
            autoFocus
            {...form.register("name")}
            error={Boolean(errors.name)}
          />
        </FormField>
        <FormField
          label={t("products.sellPrice")}
          error={errors.sellPrice?.message}
        >
          <Input
            type="number"
            step="0.01"
            {...form.register("sellPrice")}
            error={Boolean(errors.sellPrice)}
          />
        </FormField>
        <FormField
          label={t("products.quantityInStock")}
          error={errors.quantityInStock?.message}
        >
          <Input
            type="number"
            step="1"
            {...form.register("quantityInStock")}
            error={Boolean(errors.quantityInStock)}
          />
        </FormField>
        <FormField
          label={t("products.buyPrice")}
          error={errors.buyPrice?.message}
        >
          <Input
            type="number"
            step="0.01"
            {...form.register("buyPrice")}
            error={Boolean(errors.buyPrice)}
          />
        </FormField>
        <FormField
          label={t("products.category")}
          error={errors.category?.message}
        >
          <Input
            {...form.register("category")}
            error={Boolean(errors.category)}
          />
        </FormField>
        <FormField label={t("products.unit")} error={errors.unit?.message}>
          <Input {...form.register("unit")} error={Boolean(errors.unit)} />
        </FormField>
        <FormField
          label={t("products.minimumStockAlert")}
          error={errors.minimumStockAlert?.message}
        >
          <Input
            type="number"
            step="1"
            {...form.register("minimumStockAlert")}
            error={Boolean(errors.minimumStockAlert)}
          />
        </FormField>
        <button type="submit" className="hidden" disabled={saving} />
      </form>
    </Modal>
  );
}

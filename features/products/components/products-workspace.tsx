"use client";

import { useState } from "react";
import type { Product } from "@/types/domain";
import { ProductForm } from "./product-form";
import { ProductsTable } from "./products-table";
import { ProductImportExport } from "./product-import-export";
import { SectionCard } from "@/components/ui/section-card";
import { useLocale } from "@/components/providers/locale-context";

export function ProductsWorkspace() {
  const { t } = useLocale();
  const [selectedProduct, setSelectedProduct] = useState<Product | undefined>();

  return (
    <div className="flex flex-col gap-5">
      <ProductImportExport />
      <SectionCard
        title={
          selectedProduct
            ? `${t("products.editProduct")}: ${selectedProduct.name}`
            : t("products.addProduct")
        }
      >
        <ProductForm
          product={selectedProduct}
          onSaved={() => setSelectedProduct(undefined)}
        />
      </SectionCard>
      <ProductsTable onEdit={setSelectedProduct} />
    </div>
  );
}

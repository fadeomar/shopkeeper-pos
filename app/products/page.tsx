"use client";

import { ProductsWorkspace } from "@/features/products/components/products-workspace";
import { useLocale } from "@/components/providers/locale-context";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";

export default function ProductsPage() {
  const { t } = useLocale();
  return (
    <PageShell>
      <PageHeader
        title={t("products.title")}
        description={t("products.subtitle")}
      />
      <ProductsWorkspace />
    </PageShell>
  );
}

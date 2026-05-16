"use client";

import { InventoryWorkspace } from "@/features/inventory/components/inventory-workspace";
import { useLocale } from "@/components/providers/locale-context";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";

export default function InventoryPage() {
  const { t } = useLocale();

  return (
    <PageShell>
      <PageHeader
        title={t("inventory.title")}
        description={t("inventory.subtitle")}
      />
      <InventoryWorkspace />
    </PageShell>
  );
}

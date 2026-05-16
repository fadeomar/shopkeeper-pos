"use client";

import { SupplierLedgerWorkspace } from "@/features/suppliers/components/supplier-ledger-workspace";
import { useLocale } from "@/components/providers/locale-context";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";

export default function SuppliersPage() {
  const { t } = useLocale();

  return (
    <PageShell>
      <PageHeader
        title={t("suppliers.title")}
        description={t("suppliers.subtitle")}
      />
      <SupplierLedgerWorkspace />
    </PageShell>
  );
}

"use client";

import { CustomerLedgerWorkspace } from "@/features/customers/components/customer-ledger-workspace";
import { useLocale } from "@/components/providers/locale-context";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";

export default function CustomersPage() {
  const { t } = useLocale();

  return (
    <PageShell>
      <PageHeader
        title={t("customers.title")}
        description={t("customers.subtitle")}
      />
      <CustomerLedgerWorkspace />
    </PageShell>
  );
}

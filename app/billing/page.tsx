"use client";

import { PosScreen } from "@/features/bills/components/pos-screen";
import { useLocale } from "@/components/providers/locale-context";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";

export default function BillingPage() {
  const { t } = useLocale();
  return (
    <PageShell size="full">
      <PageHeader
        title={t("billing.title")}
        description={t("billing.subtitle")}
      />
      <PosScreen />
    </PageShell>
  );
}

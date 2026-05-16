"use client";

import { ReportsWorkspace } from "@/features/reports/components/reports-workspace";
import { useLocale } from "@/components/providers/locale-context";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";

export const dynamic = "force-dynamic";

export default function ReportsPage() {
  const { t } = useLocale();

  return (
    <PageShell>
      <PageHeader
        title={t("reports.title")}
        description={t("reports.subtitle")}
      />
      <ReportsWorkspace />
    </PageShell>
  );
}

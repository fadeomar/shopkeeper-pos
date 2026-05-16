"use client";

import { ShiftWorkspace } from "@/features/shift/components/shift-workspace";
import { useLocale } from "@/components/providers/locale-context";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";

export default function ShiftPage() {
  const { t } = useLocale();

  return (
    <PageShell>
      <PageHeader title={t("shift.title")} description={t("shift.subtitle")} />
      <ShiftWorkspace />
    </PageShell>
  );
}

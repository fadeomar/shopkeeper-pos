"use client";

import Link from "next/link";
import { Truck } from "lucide-react";
import { PurchaseHistory } from "@/features/purchases/components/purchase-history";
import { useLocale } from "@/components/providers/locale-context";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";

export default function PurchasesPage() {
  const { t } = useLocale();
  return (
    <PageShell size="wide">
      <PageHeader
        title={t("purchases.historyTitle")}
        icon={<Truck size={24} aria-hidden />}
        actions={
          <Link
            href={"/purchases/new" as never}
            className="inline-flex h-[42px] items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-hover active:bg-brand-hover"
          >
            {t("purchases.newPurchase")}
          </Link>
        }
      />
      <PurchaseHistory />
    </PageShell>
  );
}

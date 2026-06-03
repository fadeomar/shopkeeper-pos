"use client";

import Link from "next/link";
import { use } from "react";
import { PurchaseDetail } from "@/features/purchases/components/purchase-detail";
import { useLocale } from "@/components/providers/locale-context";

export default function PurchaseDetailPage({ params }: { params: Promise<{ purchaseId: string }> }) {
  const { purchaseId } = use(params);
  const { t, dir } = useLocale();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/purchases" className="inline-flex items-center gap-1.5 text-sm font-medium text-info transition-colors hover:text-info/80">
          {dir === "rtl" ? "→" : "←"} {t("purchases.backToPurchases")}
        </Link>
      </div>
      <PurchaseDetail purchaseId={purchaseId} />
    </div>
  );
}

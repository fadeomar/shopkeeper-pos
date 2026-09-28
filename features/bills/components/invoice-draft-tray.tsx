"use client";

import clsx from "clsx";
import { Plus, X } from "lucide-react";
import { useLocale } from "@/components/providers/locale-context";
import { calculateBillTotals } from "@/lib/utils/calculations";
import { formatCurrency } from "@/lib/utils/money";
import type { PosInvoiceDraft } from "@/features/bills/utils/pos-drafts";

export function InvoiceDraftTray({
  drafts,
  activeDraftId,
  currency,
  onActivate,
  onCancel,
  onCreate,
}: {
  drafts: PosInvoiceDraft[];
  activeDraftId: string | null;
  currency: string;
  onActivate: (draftId: string) => void;
  onCancel: (draftId: string) => void;
  onCreate: () => void;
}) {
  const { t } = useLocale();

  return (
    <div
      className={clsx(
        "fixed z-30 border-t border-border-default bg-surface/95 shadow-[0_-8px_24px_rgba(11,18,32,0.08)] backdrop-blur",
        "inset-x-0 bottom-[calc(4rem+max(env(safe-area-inset-bottom),0.5rem)+1px)]",
        "lg:start-[260px] lg:end-0 lg:bottom-0",
      )}
      aria-label={t("billing.openInvoices")}
    >
      <div className="flex h-14 items-stretch gap-1.5 px-2 py-1.5 sm:px-3">
        <div
          role="group"
          aria-label={t("billing.openInvoices")}
          className="flex min-w-0 flex-1 items-stretch gap-1.5 overflow-x-auto overscroll-x-contain"
        >
          {drafts.map((draft) => {
            const active = draft.id === activeDraftId;
            const totals = calculateBillTotals(
              draft.items.map((item) => ({
                quantity: item.quantity,
                unitBuyPrice: item.unitBuyPrice,
                unitSellPrice: item.unitSellPrice,
              })),
              Number(draft.form.discountAmount || 0),
              Number(draft.form.taxAmount || 0),
            );
            const customer = draft.form.customerName?.trim();
            const label =
              customer ||
              t("billing.invoiceDraftNumber", {
                number: String(draft.draftNumber),
              });

            return (
              <div
                key={draft.id}
                className={clsx(
                  "group flex shrink-0 items-stretch overflow-hidden rounded-xl border transition-colors",
                  active
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-border-default bg-surface-soft text-fg-secondary hover:border-border-strong hover:bg-surface-muted",
                )}
              >
                <button
                  type="button"
                  aria-pressed={active}
                  aria-label={t("billing.switchInvoice", {
                    number: String(draft.draftNumber),
                  })}
                  onClick={() => onActivate(draft.id)}
                  className="flex min-w-[150px] max-w-[220px] flex-col justify-center px-3 py-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                >
                  <span className="truncate text-xs font-bold leading-tight">
                    {label}
                  </span>
                  <span className="truncate text-[11px] font-medium leading-tight opacity-75">
                    {draft.items.length} {t("billing.items")} ·{" "}
                    <span dir="ltr">
                      {formatCurrency(totals.totalAmount, currency)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={t("billing.cancelInvoiceNumber", {
                    number: String(draft.draftNumber),
                  })}
                  onClick={() => onCancel(draft.id)}
                  className={clsx(
                    "flex w-11 shrink-0 items-center justify-center border-s text-current/70 transition-colors hover:bg-danger-soft hover:text-danger",
                    active ? "border-brand/20" : "border-border-default",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                  )}
                >
                  <X size={15} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onCreate}
          aria-label={t("billing.newInvoice")}
          className="inline-flex h-full shrink-0 items-center justify-center gap-1.5 rounded-xl border border-brand/30 bg-brand-soft px-3 text-xs font-bold text-brand transition-colors hover:bg-brand-soft/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Plus size={16} aria-hidden />
          <span className="hidden sm:inline">{t("billing.newInvoice")}</span>
        </button>
      </div>
    </div>
  );
}

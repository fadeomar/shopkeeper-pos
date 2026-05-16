"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import { useLocale } from "@/components/providers/locale-context";
import { useToast } from "@/components/ui/toast";
import { formatCurrency } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/date";
import { getBillNetTotal } from "@/features/bills/utils/bill-summary";
import { buildReceiptText } from "@/features/bills/utils/receipt-format";
import { normalizeBillSplit } from "@/lib/utils/bill-split";
import { dividerClasses } from "@/lib/design/variants";
import type { Bill, BillItem, Settings } from "@/types/domain";

function billTone(status: string) {
  if (status === "finalized") return "success" as const;
  if (status === "voided") return "danger" as const;
  return "warning" as const;
}

export function ReceiptView({
  bill,
  items,
  settings,
}: {
  bill: Bill;
  items: BillItem[];
  settings?: Settings;
}) {
  const { t } = useLocale();
  const { push } = useToast();
  const currency = settings?.currency ?? "USD";
  const storeName = settings?.storeName || "Shopkeeper POS";
  const paymentLabel = t(
    `common.${bill.paymentMethod}` as Parameters<typeof t>[0],
  );

  const billWithSplit = useMemo(() => normalizeBillSplit(bill) as Bill, [bill]);
  const splitMethodCount =
    (billWithSplit.cashAmount > 0 ? 1 : 0) +
    (billWithSplit.cardAmount > 0 ? 1 : 0) +
    (billWithSplit.creditAmount > 0 ? 1 : 0);
  const showSplitSection = splitMethodCount > 1;

  const receiptText = useMemo(
    () =>
      buildReceiptText({
        bill,
        items,
        settings,
        labels: {
          receipt: t("bills.receipt"),
          billNumber: t("bills.billNumber"),
          dateTime: t("bills.dateTime"),
          cashier: t("bills.cashier"),
          customer: t("bills.customer"),
          payment: t("bills.payment"),
          subtotal: t("bills.subtotal"),
          discount: t("bills.discount"),
          tax: t("bills.tax"),
          total: t("bills.total"),
          returnedAmount: t("bills.returnedAmount"),
          netTotal: t("bills.netTotal"),
          status: t("bills.status"),
          billStatus: t(`common.${bill.status}` as Parameters<typeof t>[0]),
          paid: t("bills.paid"),
          change: t("bills.change"),
          cashLabel: t("common.cash"),
          cardLabel: t("common.card"),
          creditLabel: t("common.credit"),
          qty: t("billing.qty"),
          thankYou: t("bills.thankYou"),
          walkin: t("common.walkin"),
          paymentMethod: paymentLabel,
        },
      }),
    [bill, items, settings, t, paymentLabel],
  );

  async function handleShare() {
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${t("bills.receipt")} ${bill.billNumber}`,
          text: receiptText,
        });
        return;
      }
      await navigator.clipboard.writeText(receiptText);
      push(t("bills.receiptCopied"));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      push(t("bills.receiptShareFailed"), "error");
    }
  }

  return (
    <SectionCard
      title={t("bills.receipt")}
      description={t("bills.receiptDesc")}
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.print()}
          >
            {t("bills.printReceipt")}
          </Button>
          <Button type="button" size="sm" onClick={handleShare}>
            {t("bills.shareReceipt")}
          </Button>
        </>
      }
      className="no-print"
    >
      <div
        id="receipt-print-area"
        className="mx-auto max-w-sm rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm print:shadow-none print:border-0"
      >
        <div className="mb-3 border-b border-dashed border-slate-300 pb-3 text-center">
          <p className="text-lg font-black tracking-tight">{storeName}</p>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
            {t("bills.receipt")}
          </p>
        </div>

        <div className="mb-3 space-y-1 border-b border-dashed border-slate-300 pb-3 text-xs text-slate-600">
          <div className="flex justify-between gap-3">
            <span>{t("bills.billNumber")}</span>
            <strong className="text-slate-900">{bill.billNumber}</strong>
          </div>
          <div className="flex justify-between gap-3">
            <span>{t("bills.dateTime")}</span>
            <strong className="text-end text-slate-900">
              {formatDateTime(bill.createdAt)}
            </strong>
          </div>
          <div className="flex justify-between gap-3">
            <span>{t("bills.cashier")}</span>
            <strong className="text-slate-900">
              {bill.cashierName || settings?.cashierName || "—"}
            </strong>
          </div>
          <div className="flex justify-between gap-3">
            <span>{t("bills.customer")}</span>
            <strong className="text-slate-900">
              {bill.customerName || t("common.walkin")}
            </strong>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>{t("bills.payment")}</span>
            <Badge tone="neutral">{paymentLabel}</Badge>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>{t("bills.status")}</span>
            <StatusPill
              status={bill.status}
              tone={billTone(bill.status)}
              label={t(`common.${bill.status}` as Parameters<typeof t>[0])}
            />
          </div>
        </div>

        <div className="mb-3 space-y-2 border-b border-dashed border-slate-300 pb-3">
          {items.map((item) => (
            <div key={item.id} className="text-xs">
              <div className="flex justify-between gap-3 font-semibold text-slate-900">
                <span>{item.productNameAtSale}</span>
                <span>{formatCurrency(item.lineSubtotal, currency)}</span>
              </div>
              <div className="mt-0.5 flex justify-between gap-3 text-slate-500">
                <span>{item.barcodeAtSale}</span>
                <span>
                  {item.quantitySold} ×{" "}
                  {formatCurrency(item.unitSellPriceAtSale, currency)}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span>{t("bills.subtotal")}</span>
            <span>{formatCurrency(bill.subtotal, currency)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t("bills.discount")}</span>
            <span>{formatCurrency(bill.discountAmount, currency)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t("bills.tax")}</span>
            <span>{formatCurrency(bill.taxAmount, currency)}</span>
          </div>
          <div
            className={`mt-2 flex justify-between border-t pt-2 text-base font-black ${dividerClasses.borderDefault}`}
          >
            <span>{t("bills.total")}</span>
            <span>{formatCurrency(bill.totalAmount, currency)}</span>
          </div>
          {(bill.returnedAmount ?? 0) > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>{t("bills.returnedAmount")}</span>
              <span>-{formatCurrency(bill.returnedAmount ?? 0, currency)}</span>
            </div>
          )}
          {(bill.returnedAmount ?? 0) > 0 && (
            <div className="flex justify-between font-bold">
              <span>{t("bills.netTotal")}</span>
              <span>{formatCurrency(getBillNetTotal(bill), currency)}</span>
            </div>
          )}
          {showSplitSection && (
            <div className="mt-2 space-y-0.5 rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-xs text-slate-600">
              {billWithSplit.cashAmount > 0 && (
                <div className="flex justify-between">
                  <span>{t("common.cash")}</span>
                  <span className="tabular-nums">
                    {formatCurrency(billWithSplit.cashAmount, currency)}
                  </span>
                </div>
              )}
              {billWithSplit.cardAmount > 0 && (
                <div className="flex justify-between">
                  <span>{t("common.card")}</span>
                  <span className="tabular-nums">
                    {formatCurrency(billWithSplit.cardAmount, currency)}
                  </span>
                </div>
              )}
              {billWithSplit.creditAmount > 0 && (
                <div className="flex justify-between font-semibold text-red-600">
                  <span>{t("common.credit")}</span>
                  <span className="tabular-nums">
                    {formatCurrency(billWithSplit.creditAmount, currency)}
                  </span>
                </div>
              )}
            </div>
          )}
          <div className="flex justify-between text-slate-600">
            <span>{t("bills.paid")}</span>
            <span>{formatCurrency(bill.paidAmount, currency)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>{t("bills.change")}</span>
            <span>{formatCurrency(bill.changeAmount, currency)}</span>
          </div>
        </div>

        <p className="mt-5 text-center text-xs font-medium text-slate-500">
          {t("bills.thankYou")}
        </p>
      </div>
    </SectionCard>
  );
}

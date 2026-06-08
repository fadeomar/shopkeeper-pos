"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import { formatCurrency } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/date";
import { isMiscLine } from "@/lib/utils/misc-items";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, useDataTableLabels } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { RecordSyncBadge } from "@/components/sync/record-sync-badge";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import type { PurchaseItem } from "@/types/domain";

function DetailField({ label, value, dir }: { label: string; value: string; dir?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-800" dir={dir}>{value}</span>
    </div>
  );
}

function SummaryRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <span className={highlight ? "text-sm font-semibold text-slate-900" : "text-sm text-slate-500"}>{label}</span>
      <span className={highlight ? "text-sm font-bold tabular-nums text-slate-900" : "text-sm font-medium tabular-nums text-slate-700"} dir="ltr">{value}</span>
    </div>
  );
}

export function PurchaseDetail({ purchaseId }: { purchaseId: string }) {
  const { t } = useLocale();
  const tableLabels = useDataTableLabels();
  const { push } = useToast();
  const purchase = useLiveQuery(() => db.purchases.get(purchaseId), [purchaseId]);
  const items = useLiveQuery(
    () => db.purchaseItems.where("purchaseId").equals(purchaseId).toArray(),
    [purchaseId],
  );
  const products = useLiveQuery(() => db.products.toArray(), []);
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const currency = settings?.currency ?? "ILS";
  const productById = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product])),
    [products],
  );

  if (purchase === undefined || items === undefined) {
    return <Card><p className="text-sm text-slate-500">{t("purchases.loadingPurchase")}</p></Card>;
  }
  if (!purchase) {
    return <EmptyState title={t("purchases.purchaseNotFound")} description={t("purchases.purchaseNotFoundDesc")} />;
  }

  const amountDue = Math.max(0, purchase.totalAmount - (purchase.returnedAmount ?? 0) - purchase.paidAmount);
  const storeName = settings?.storeName || "Asas POS";

  async function copyPurchaseNumber() {
    await navigator.clipboard.writeText(purchase!.purchaseNumber);
    push(t("purchases.purchaseNumberCopied"));
  }

  const columns: ColumnDef<PurchaseItem, unknown>[] = [
    {
      accessorKey: "barcodeAtPurchase",
      header: t("purchases.barcodeAtPurchase"),
      cell: ({ row }) => <span className="font-mono text-xs tabular-nums text-slate-600">{row.original.barcodeAtPurchase}</span>,
    },
    {
      accessorKey: "productNameAtPurchase",
      header: t("purchases.productAtPurchase"),
      cell: ({ row }) => {
        const product = productById.get(row.original.originalProductId);
        return product ? (
          <Link href="/products" className="font-medium text-info hover:text-info/80">
            {row.original.productNameAtPurchase}
          </Link>
        ) : (
          <span className="font-medium text-slate-800">{row.original.productNameAtPurchase}</span>
        );
      },
    },
    { accessorKey: "categoryAtPurchase", header: t("purchases.categoryAtPurchase") },
    {
      accessorKey: "quantityPurchased",
      header: t("purchases.qty"),
      cell: ({ row }) => <span className="tabular-nums text-slate-700">{row.original.quantityPurchased}</span>,
    },
    {
      accessorKey: "unitCostAtPurchase",
      header: t("purchases.unitCost"),
      cell: ({ row }) => <span className="tabular-nums text-slate-700" dir="ltr">{formatCurrency(row.original.unitCostAtPurchase, currency)}</span>,
    },
    {
      accessorKey: "lineSubtotal",
      header: t("purchases.lineTotal"),
      cell: ({ row }) => <span className="font-semibold tabular-nums text-slate-900" dir="ltr">{formatCurrency(row.original.lineSubtotal, currency)}</span>,
    },
    {
      id: "stockImpact",
      header: t("purchases.stockImpact"),
      cell: ({ row }) =>
        isMiscLine(row.original) ? (
          <span className="text-slate-400">—</span>
        ) : (
          <span className="font-semibold text-success">+{row.original.quantityPurchased}</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Card className="no-print">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{purchase.purchaseNumber}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("purchases.purchaseDetailDesc")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={copyPurchaseNumber}>{t("purchases.copyPurchaseNumber")}</Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => window.print()}>{t("purchases.printPurchase")}</Button>
            {purchase.supplierId && (
              <Link href="/suppliers" className="inline-flex min-h-[36px] items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                {t("purchases.openSupplierLedger")}
              </Link>
            )}
          </div>
        </div>
      </Card>

      <div id="receipt-print-area" className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm print:border-0 print:shadow-none">
        <div className="border-b border-dashed border-slate-300 pb-4 text-center">
          <p className="text-lg font-black tracking-tight">{storeName}</p>
          {settings?.businessPhone && <p className="text-xs text-slate-500">{settings.businessPhone}</p>}
          {settings?.businessAddress && <p className="text-xs text-slate-500">{settings.businessAddress}</p>}
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">{t("purchases.purchaseReceipt")}</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <DetailField label={t("purchases.purchaseNumber")} value={purchase.purchaseNumber} />
          <DetailField label={t("purchases.createdAt")} value={formatDateTime(purchase.createdAt)} />
          <DetailField label={t("purchases.recordedBy")} value={purchase.cashierName || "—"} />
          <DetailField label={t("purchases.supplier")} value={purchase.supplierName || t("purchases.walkInSupplier")} />
          <DetailField label={t("suppliers.phone")} value={purchase.supplierPhone || "—"} />
          <DetailField label={t("purchases.paymentMethod")} value={t(`common.${purchase.paymentMethod}`)} />
          <DetailField label={t("purchases.invoiceNumber")} value={purchase.supplierInvoiceNumber || "—"} />
          <DetailField label={t("purchases.invoiceDate")} value={purchase.invoiceDate || "—"} />
          <DetailField label={t("purchases.paymentDueDate")} value={purchase.paymentDueDate || "—"} />
          <DetailField label={t("purchases.status")} value={t(`common.${purchase.status}`)} />
          <DetailField label={t("sync.status")} value={purchase.syncStatus || "—"} />
          <DetailField label={t("purchases.amountDue")} value={formatCurrency(amountDue, currency)} dir="ltr" />
        </div>

        <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-100 print:overflow-visible">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-start">{t("purchases.productAtPurchase")}</th>
                <th className="px-3 py-2 text-end">{t("purchases.qty")}</th>
                <th className="px-3 py-2 text-end">{t("purchases.unitCost")}</th>
                <th className="px-3 py-2 text-end">{t("purchases.lineTotal")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">
                    <p className="font-semibold text-slate-900">{item.productNameAtPurchase}</p>
                    <p className="text-xs text-slate-500">{item.barcodeAtPurchase} · {item.categoryAtPurchase || "—"}</p>
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{item.quantityPurchased}</td>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">{formatCurrency(item.unitCostAtPurchase, currency)}</td>
                  <td className="px-3 py-2 text-end font-semibold tabular-nums" dir="ltr">{formatCurrency(item.lineSubtotal, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 max-w-sm ms-auto">
          <SummaryRow label={t("purchases.subtotal")} value={formatCurrency(purchase.subtotal, currency)} />
          <SummaryRow label={t("purchases.discount")} value={formatCurrency(purchase.discountAmount, currency)} />
          <SummaryRow label={t("purchases.tax")} value={formatCurrency(purchase.taxAmount, currency)} />
          <SummaryRow label={t("purchases.total")} value={formatCurrency(purchase.totalAmount, currency)} highlight />
          <SummaryRow label={t("purchases.paid")} value={formatCurrency(purchase.paidAmount, currency)} />
          <SummaryRow label={t("purchases.amountDue")} value={formatCurrency(amountDue, currency)} highlight={amountDue > 0} />
        </div>

        {purchase.notes && (
          <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-500 whitespace-pre-line">
            <span className="font-medium text-slate-700">{t("purchases.notes")}:</span> {purchase.notes}
          </p>
        )}
      </div>

      <div className="no-print">
        <DataTable
          columns={columns}
          data={items}
          title={t("purchases.items")}
          emptyTitle={t("common.noResults")}
          enableGlobalSearch={false}
          pageSize={10}
          labels={tableLabels}
        />
        <div className="mt-3 flex justify-end">
          <RecordSyncBadge status={purchase.syncStatus} />
        </div>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import { formatCurrency } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/date";
import { isMiscLine } from "@/lib/utils/misc-items";
import { getBaseUnitName } from "@/lib/utils/multi-unit";
import { gramsToKg, kgToGrams } from "@/lib/utils/weight";
import { getServiceErrorMessage } from "@/lib/errors/get-error-message";
import { returnPurchaseItem, voidPurchase } from "@/lib/services/purchase-service";
import { usePermissions } from "@/lib/hooks/use-permissions";
import {
  formatPurchaseBaseQuantity,
  formatPurchaseQuantity,
  formatPurchaseStockImpact,
  purchaseUnitCostSuffix,
} from "@/features/purchases/utils/purchase-display";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { NumberField } from "@/components/ui/number-field";
import { QuantityStepper } from "@/components/pos/quantity-stepper";
import { Ban, RotateCcw } from "@/components/ui/icons";
import { DataTable, useDataTableLabels } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { RecordSyncBadge } from "@/components/sync/record-sync-badge";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import type { PurchaseItem } from "@/types/domain";

/**
 * Remaining quantity in BASE units (grams for weight, base pieces for
 * multi_unit and unit lines) — the unit returnPurchaseItem/voidPurchase expect
 * and the inventory-accurate "can still return".
 */
function remainingBaseQuantity(item: PurchaseItem): number {
  return Math.max(0, item.quantityPurchased - (item.quantityReturned ?? 0));
}

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
  const { canVoid: permCanVoid, canReturn: permCanReturn } = usePermissions();
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

  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [returnTarget, setReturnTarget] = useState<PurchaseItem | null>(null);
  const [returnQuantity, setReturnQuantity] = useState<number>(1);
  const [returnReason, setReturnReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  if (purchase === undefined || items === undefined) {
    return <Card><p className="text-sm text-slate-500">{t("purchases.loadingPurchase")}</p></Card>;
  }
  if (!purchase) {
    return <EmptyState title={t("purchases.purchaseNotFound")} description={t("purchases.purchaseNotFoundDesc")} />;
  }

  const amountDue = Math.max(0, purchase.totalAmount - (purchase.returnedAmount ?? 0) - purchase.paidAmount);
  const storeName = settings?.storeName || "Asas POS";

  // A purchase can only be voided while fully finalized (no returns yet); a
  // return is allowed on anything not already voided. Stock direction flips vs.
  // a bill: void/return REMOVE the stock the purchase added.
  const purchaseCanVoid = purchase.status === "finalized";
  const purchaseCanReturn = purchase.status !== "voided";

  const returnIsWeight = returnTarget?.saleType === "weight";
  const returnIsMulti = returnTarget?.saleType === "multi_unit";
  const returnConversion = returnTarget?.conversionToBaseAtPurchase ?? 1;
  // Remaining in base units (grams/pieces); the input shows kg for weight and
  // the bought-unit count (base ÷ conversion) for multi_unit.
  const selectedRemainingBase = returnTarget ? remainingBaseQuantity(returnTarget) : 0;
  const selectedRemainingInput = returnIsWeight
    ? gramsToKg(selectedRemainingBase)
    : returnIsMulti
      ? Math.floor(selectedRemainingBase / returnConversion)
      : selectedRemainingBase;

  async function copyPurchaseNumber() {
    await navigator.clipboard.writeText(purchase!.purchaseNumber);
    push(t("purchases.purchaseNumberCopied"));
  }

  async function handleVoid() {
    try {
      setIsSaving(true);
      await voidPurchase({ purchaseId: purchase!.id, reason: voidReason });
      setVoidOpen(false);
      setVoidReason("");
      push(t("purchases.purchaseVoided"));
    } catch (err) {
      push(getServiceErrorMessage(err, t, t("purchases.voidFailed")), "error");
    } finally {
      setIsSaving(false);
    }
  }

  function openReturn(item: PurchaseItem) {
    const remainingBase = remainingBaseQuantity(item);
    setReturnTarget(item);
    // returnQuantity is in the input unit: kg for weight, bought-unit count for
    // multi_unit, base pieces otherwise.
    setReturnQuantity(
      item.saleType === "weight"
        ? gramsToKg(remainingBase)
        : item.saleType === "multi_unit"
          ? Math.floor(remainingBase / (item.conversionToBaseAtPurchase ?? 1))
          : remainingBase,
    );
    setReturnReason("");
  }

  async function handleReturn() {
    if (!returnTarget) return;
    try {
      setIsSaving(true);
      await returnPurchaseItem({
        purchaseId: purchase!.id,
        itemId: returnTarget.id,
        // Service expects base units: grams for weight, base pieces for
        // multi_unit (bought-unit count × conversion); the input is kg /
        // bought-unit count respectively.
        quantity: returnIsWeight
          ? kgToGrams(returnQuantity)
          : returnIsMulti
            ? Math.round(returnQuantity * returnConversion)
            : returnQuantity,
        reason: returnReason,
      });
      setReturnTarget(null);
      setReturnQuantity(1);
      setReturnReason("");
      push(t("purchases.itemReturned"));
    } catch (err) {
      push(getServiceErrorMessage(err, t, t("purchases.returnFailed")), "error");
    } finally {
      setIsSaving(false);
    }
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
      // Labelled with the bought unit ("10 box", "2.5 kg") so a multi-unit /
      // weight quantity isn't shown as a bare base-unit-looking number.
      cell: ({ row }) => <span className="tabular-nums text-slate-700">{formatPurchaseQuantity(row.original)}</span>,
    },
    {
      accessorKey: "unitCostAtPurchase",
      header: t("purchases.unitCost"),
      cell: ({ row }) => (
        <span className="tabular-nums text-slate-700" dir="ltr">
          {formatCurrency(row.original.unitCostAtPurchase, currency)}
          {purchaseUnitCostSuffix(row.original, t("weight.perKgSuffix"))}
        </span>
      ),
    },
    {
      accessorKey: "lineSubtotal",
      header: t("purchases.lineTotal"),
      cell: ({ row }) => <span className="font-semibold tabular-nums text-slate-900" dir="ltr">{formatCurrency(row.original.lineSubtotal, currency)}</span>,
    },
    {
      id: "stockImpact",
      header: t("purchases.stockImpact"),
      // The base-unit count actually added to stock (+1500 pill), NOT the
      // bought-unit count (+10 box) the old UI mistakenly showed.
      cell: ({ row }) => {
        const item = row.original;
        if (isMiscLine(item)) return <span className="text-slate-400">—</span>;
        const product = productById.get(item.originalProductId);
        const baseUnitName = product ? getBaseUnitName(product) : "";
        return (
          <span className="font-semibold text-success">
            {formatPurchaseStockImpact(item, baseUnitName)}
          </span>
        );
      },
    },
    {
      accessorKey: "quantityReturned",
      header: t("purchases.returnedQty"),
      cell: ({ row }) => {
        const returned = row.original.quantityReturned ?? 0;
        return (
          <span className="tabular-nums text-slate-700">
            {returned > 0 ? formatPurchaseBaseQuantity(row.original, returned) : "—"}
          </span>
        );
      },
    },
    ...(permCanReturn
      ? [
          {
            id: "actions",
            header: t("purchases.action"),
            enableSorting: false,
            cell: ({ row }: { row: { original: PurchaseItem } }) => {
              const item = row.original;
              const remainingBase = remainingBaseQuantity(item);
              return (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!purchaseCanReturn || remainingBase <= 0}
                  onClick={() => openReturn(item)}
                >
                  <RotateCcw className="size-4" aria-hidden />
                  {t("purchases.returnItem")}
                </Button>
              );
            },
          } satisfies ColumnDef<PurchaseItem, unknown>,
        ]
      : []),
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

      {permCanVoid && (
        <Card className="no-print">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">{t("purchases.actions")}</h3>
              <p className="mt-1 text-sm text-slate-500">{t("purchases.actionsDesc")}</p>
            </div>
            <Button
              type="button"
              variant="danger"
              disabled={!purchaseCanVoid}
              onClick={() => setVoidOpen(true)}
            >
              <Ban className="size-4" aria-hidden />
              {t("purchases.voidPurchase")}
            </Button>
          </div>
          {!purchaseCanVoid && purchase.status !== "voided" && (
            <p className="mt-3 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
              {t("purchases.voidOnlyFinalized")}
            </p>
          )}
        </Card>
      )}

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
                  <td className="px-3 py-2 text-end tabular-nums">{formatPurchaseQuantity(item)}</td>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">{formatCurrency(item.unitCostAtPurchase, currency)}{purchaseUnitCostSuffix(item, t("weight.perKgSuffix"))}</td>
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

      <Modal
        open={voidOpen}
        title={t("purchases.voidPurchase")}
        description={t("purchases.voidPurchaseDesc")}
        onClose={() => setVoidOpen(false)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setVoidOpen(false)} disabled={isSaving}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="danger" onClick={handleVoid} disabled={isSaving || !voidReason.trim()}>
              {t("purchases.confirmVoid")}
            </Button>
          </>
        }
      >
        <label className="text-sm font-medium text-slate-700" htmlFor="purchase-void-reason">
          {t("purchases.voidReason")}
        </label>
        <textarea
          id="purchase-void-reason"
          value={voidReason}
          onChange={(event) => setVoidReason(event.target.value)}
          className="mt-2 w-full min-h-24 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          placeholder={t("purchases.reasonPlaceholder")}
        />
      </Modal>

      <Modal
        open={Boolean(returnTarget)}
        title={t("purchases.returnItem")}
        description={
          returnTarget
            ? `${returnTarget.productNameAtPurchase} — ${t("purchases.remainingQty")}: ${formatPurchaseBaseQuantity(returnTarget, selectedRemainingBase)}`
            : undefined
        }
        onClose={() => setReturnTarget(null)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setReturnTarget(null)} disabled={isSaving}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleReturn}
              disabled={
                isSaving ||
                !returnReason.trim() ||
                returnQuantity <= 0 ||
                returnQuantity > selectedRemainingInput
              }
            >
              {t("purchases.confirmReturn")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-slate-700" htmlFor="purchase-return-quantity">
              {returnIsWeight ? t("weight.label") : t("purchases.returnQuantity")}
            </label>
            {returnIsWeight ? (
              <div className="mt-2 flex items-center gap-2">
                <NumberField
                  value={returnQuantity}
                  onValueChange={setReturnQuantity}
                  precision="decimal"
                  min={0}
                  max={selectedRemainingInput}
                  fullWidth={false}
                  className="w-[140px]"
                />
                <span className="text-sm text-slate-500">{t("weight.kgUnit")}</span>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <QuantityStepper
                  value={returnQuantity}
                  onChange={setReturnQuantity}
                  min={1}
                  max={selectedRemainingInput}
                />
                {returnIsMulti && returnTarget?.purchaseUnitNameAtPurchase && (
                  <span className="text-sm text-slate-500">{returnTarget.purchaseUnitNameAtPurchase}</span>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700" htmlFor="purchase-return-reason">
              {t("purchases.returnReason")}
            </label>
            <textarea
              id="purchase-return-reason"
              value={returnReason}
              onChange={(event) => setReturnReason(event.target.value)}
              className="mt-2 w-full min-h-24 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              placeholder={t("purchases.reasonPlaceholder")}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

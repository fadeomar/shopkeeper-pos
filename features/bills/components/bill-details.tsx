"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import { formatDateTime } from "@/lib/utils/date";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { LoadingState } from "@/components/ui/loading-state";
import { SectionCard } from "@/components/ui/section-card";
import { TableShell } from "@/components/ui/table-shell";
import { FormField } from "@/components/ui/form-field";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import { PriceDisplay } from "@/components/pos/price-display";
import { returnBillItem, voidBill } from "@/lib/services/billing-service";
import {
  getBillNetProfit,
  getBillNetTotal,
} from "@/features/bills/utils/bill-summary";
import { ReceiptView } from "@/features/bills/components/receipt-view";
import { alertTones, typographyClasses } from "@/lib/design/variants";
import type { BillItem } from "@/types/domain";

function billTone(status: string) {
  if (status === "finalized") return "success" as const;
  if (status === "voided") return "danger" as const;
  return "warning" as const;
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-slate-50 p-3">
      <span className={typographyClasses.statLabel}>{label}</span>
      <span className="text-sm font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <span
        className={
          highlight
            ? "text-sm font-semibold text-slate-900"
            : "text-sm text-slate-500"
        }
      >
        {label}
      </span>
      <span
        className={
          highlight
            ? "text-sm font-bold text-slate-900 tabular-nums"
            : "text-sm font-medium text-slate-700 tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}

function remainingQuantity(item: BillItem) {
  return Math.max(0, item.quantitySold - (item.quantityReturned ?? 0));
}

export function BillDetails({ billId }: { billId: string }) {
  const { t } = useLocale();
  const toast = useToast();
  const bill = useLiveQuery(() => db.bills.get(billId), [billId]);
  const items = useLiveQuery(
    () => db.billItems.where("billId").equals(billId).toArray(),
    [billId],
  );
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const currency = settings?.currency ?? "USD";
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [returnItem, setReturnItem] = useState<BillItem | null>(null);
  const [returnQuantity, setReturnQuantity] = useState("1");
  const [returnReason, setReturnReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const netTotal = useMemo(() => (bill ? getBillNetTotal(bill) : 0), [bill]);
  const netProfit = useMemo(() => (bill ? getBillNetProfit(bill) : 0), [bill]);

  if (bill === undefined || items === undefined) {
    return <LoadingState title={t("bills.loadingBill")} />;
  }
  if (!bill) {
    return (
      <EmptyState
        title={t("bills.billNotFound")}
        description={t("bills.billNotFoundDesc")}
      />
    );
  }

  const canVoid = bill.status === "finalized";
  const canReturn = bill.status !== "voided";
  const selectedRemaining = returnItem ? remainingQuantity(returnItem) : 0;

  async function handleVoid() {
    try {
      setIsSaving(true);
      await voidBill({ billId: bill!.id, reason: voidReason });
      setVoidOpen(false);
      setVoidReason("");
      toast.push(t("bills.billVoided"));
    } catch (err) {
      toast.push(
        err instanceof Error ? err.message : t("bills.voidFailed"),
        "error",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReturn() {
    if (!returnItem) return;
    try {
      setIsSaving(true);
      await returnBillItem({
        billId: bill!.id,
        itemId: returnItem.id,
        quantity: Number(returnQuantity),
        reason: returnReason,
      });
      setReturnItem(null);
      setReturnQuantity("1");
      setReturnReason("");
      toast.push(t("bills.itemReturned"));
    } catch (err) {
      toast.push(
        err instanceof Error ? err.message : t("bills.returnFailed"),
        "error",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <ReceiptView bill={bill} items={items} settings={settings} />

      <SectionCard
        title={bill.billNumber}
        description={
          bill.voidReason
            ? `${t("bills.voidReason")}: ${bill.voidReason}`
            : bill.lastReturnReason
              ? `${t("bills.returnReason")}: ${bill.lastReturnReason}`
              : undefined
        }
        actions={
          <StatusPill
            status={bill.status}
            tone={billTone(bill.status)}
            label={t(`common.${bill.status}` as Parameters<typeof t>[0])}
          />
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <DetailField
            label={t("bills.createdAt")}
            value={formatDateTime(bill.createdAt)}
          />
          <DetailField
            label={t("bills.customer")}
            value={bill.customerName || t("common.walkin")}
          />
          <DetailField
            label={t("bills.cashier")}
            value={bill.cashierName || "—"}
          />
          <DetailField
            label={t("bills.payment")}
            value={
              <Badge tone="neutral">
                {t(`common.${bill.paymentMethod}` as Parameters<typeof t>[0])}
              </Badge>
            }
          />
          <DetailField
            label={t("bills.phone")}
            value={bill.customerPhone || "—"}
          />
          <DetailField
            label={t("bills.netTotal")}
            value={
              <PriceDisplay value={netTotal} currency={currency} emphasis />
            }
          />
        </div>
      </SectionCard>

      <SectionCard
        title={t("bills.actions")}
        description={t("bills.actionsDesc")}
        actions={
          <Button
            type="button"
            variant="danger"
            disabled={!canVoid}
            onClick={() => setVoidOpen(true)}
          >
            {t("bills.voidBill")}
          </Button>
        }
      >
        {!canVoid && bill.status !== "voided" && (
          <p
            className={`rounded-xl border px-3 py-2 text-xs ${alertTones.warning}`}
          >
            {t("bills.voidOnlyFinalized")}
          </p>
        )}
      </SectionCard>

      <TableShell
        title={t("bills.items") ?? t("bills.productAtSale")}
        description={t("bills.action")}
      >
        <table className="w-full min-w-[780px] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              {[
                t("bills.barcodeAtSale"),
                t("bills.productAtSale"),
                t("bills.categoryAtSale"),
                t("billing.qty"),
                t("bills.returnedQty"),
                t("bills.buy"),
                t("bills.sell"),
                t("bills.lineTotal"),
                t("bills.lineProfit"),
                t("bills.action"),
              ].map((h) => (
                <th key={h} className={typographyClasses.tableHeader}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => {
              const remaining = remainingQuantity(item);
              return (
                <tr
                  key={item.id}
                  className="transition-colors hover:bg-slate-50/50"
                >
                  <td className="px-3 py-2.5 text-xs font-mono text-slate-600 tabular-nums">
                    {item.barcodeAtSale}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-slate-800">
                    {item.productNameAtSale}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {item.categoryAtSale}
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 tabular-nums">
                    {item.quantitySold}
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 tabular-nums">
                    {item.quantityReturned ?? 0}
                  </td>
                  <td className="px-3 py-2.5">
                    <PriceDisplay
                      value={item.unitBuyPriceAtSale}
                      currency={currency}
                      size="sm"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <PriceDisplay
                      value={item.unitSellPriceAtSale}
                      currency={currency}
                      size="sm"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <PriceDisplay
                      value={item.lineSubtotal}
                      currency={currency}
                      size="sm"
                      emphasis
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <PriceDisplay
                      value={item.lineProfit}
                      currency={currency}
                      size="sm"
                      className="text-green-700"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!canReturn || remaining <= 0}
                      onClick={() => {
                        setReturnItem(item);
                        setReturnQuantity(String(remaining));
                      }}
                    >
                      {t("bills.returnItem")}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableShell>

      <SectionCard title={t("bills.summary") ?? t("bills.total")}>
        <div className="max-w-xs ms-auto">
          <SummaryRow
            label={t("bills.subtotal")}
            value={<PriceDisplay value={bill.subtotal} currency={currency} />}
          />
          <SummaryRow
            label={t("bills.discount")}
            value={
              <PriceDisplay value={bill.discountAmount} currency={currency} />
            }
          />
          <SummaryRow
            label={t("bills.tax")}
            value={<PriceDisplay value={bill.taxAmount} currency={currency} />}
          />
          <SummaryRow
            label={t("bills.total")}
            value={
              <PriceDisplay
                value={bill.totalAmount}
                currency={currency}
                emphasis
              />
            }
            highlight
          />
          {(bill.returnedAmount ?? 0) > 0 && (
            <SummaryRow
              label={t("bills.returnedAmount")}
              value={
                <>
                  <span>-</span>
                  <PriceDisplay
                    value={bill.returnedAmount ?? 0}
                    currency={currency}
                  />
                </>
              }
            />
          )}
          <SummaryRow
            label={t("bills.netTotal")}
            value={
              <PriceDisplay value={netTotal} currency={currency} emphasis />
            }
            highlight
          />
          <SummaryRow
            label={t("bills.paid")}
            value={<PriceDisplay value={bill.paidAmount} currency={currency} />}
          />
          <SummaryRow
            label={t("bills.change")}
            value={
              <PriceDisplay value={bill.changeAmount} currency={currency} />
            }
          />
          <SummaryRow
            label={t("bills.totalProfit")}
            value={
              <PriceDisplay value={bill.totalProfit} currency={currency} />
            }
          />
          {(bill.returnedProfit ?? 0) > 0 && (
            <SummaryRow
              label={t("bills.returnedProfit")}
              value={
                <>
                  <span>-</span>
                  <PriceDisplay
                    value={bill.returnedProfit ?? 0}
                    currency={currency}
                  />
                </>
              }
            />
          )}
          <SummaryRow
            label={t("bills.netProfit")}
            value={
              <PriceDisplay value={netProfit} currency={currency} emphasis />
            }
            highlight
          />
        </div>
        {bill.notes && (
          <p className="mt-4 whitespace-pre-line border-t border-slate-100 pt-4 text-sm text-slate-500">
            <span className="font-medium text-slate-700">
              {t("bills.notes")}:
            </span>{" "}
            {bill.notes}
          </p>
        )}
      </SectionCard>

      <Modal
        open={voidOpen}
        title={t("bills.voidBill")}
        description={t("bills.voidBillDesc")}
        onClose={() => setVoidOpen(false)}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setVoidOpen(false)}
              disabled={isSaving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleVoid}
              disabled={isSaving || !voidReason.trim()}
            >
              {t("bills.confirmVoid")}
            </Button>
          </>
        }
      >
        <FormField label={t("bills.voidReason")} htmlFor="void-reason">
          <textarea
            id="void-reason"
            value={voidReason}
            onChange={(event) => setVoidReason(event.target.value)}
            className="min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t("bills.reasonPlaceholder")}
          />
        </FormField>
      </Modal>

      <Modal
        open={Boolean(returnItem)}
        title={t("bills.returnItem")}
        description={
          returnItem
            ? `${returnItem.productNameAtSale} — ${t("bills.remainingQty")}: ${selectedRemaining}`
            : undefined
        }
        onClose={() => setReturnItem(null)}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setReturnItem(null)}
              disabled={isSaving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleReturn}
              disabled={
                isSaving ||
                !returnReason.trim() ||
                Number(returnQuantity) <= 0 ||
                Number(returnQuantity) > selectedRemaining
              }
            >
              {t("bills.confirmReturn")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <FormField
            label={t("bills.returnQuantity")}
            htmlFor="return-quantity"
          >
            <Input
              id="return-quantity"
              type="number"
              min="1"
              max={selectedRemaining}
              step="1"
              value={returnQuantity}
              onChange={(event) => setReturnQuantity(event.target.value)}
            />
          </FormField>
          <FormField label={t("bills.returnReason")} htmlFor="return-reason">
            <textarea
              id="return-reason"
              value={returnReason}
              onChange={(event) => setReturnReason(event.target.value)}
              className="min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("bills.reasonPlaceholder")}
            />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import clsx from "clsx";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import { formatCurrency } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/date";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import { returnBillItem, voidBill } from "@/lib/services/billing-service";
import {
  getBillNetProfit,
  getBillNetTotal,
} from "@/features/bills/utils/bill-summary";
import { ReceiptView } from "@/features/bills/components/receipt-view";
import type { BillItem } from "@/types/domain";

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
        {label}
      </span>
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
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-100 last:border-0">
      <span
        className={`text-sm ${highlight ? "font-semibold text-slate-900" : "text-slate-500"}`}
      >
        {label}
      </span>
      <span
        className={`text-sm tabular-nums ${highlight ? "font-bold text-slate-900" : "font-medium text-slate-700"}`}
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
    return (
      <Card>
        <p className="text-sm text-slate-500">{t("bills.loadingBill")}</p>
      </Card>
    );
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

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {bill.billNumber}
            </h2>
            {(bill.voidReason || bill.lastReturnReason) && (
              <p className="mt-1 text-xs text-slate-500">
                {bill.voidReason
                  ? `${t("bills.voidReason")}: ${bill.voidReason}`
                  : `${t("bills.returnReason")}: ${bill.lastReturnReason}`}
              </p>
            )}
          </div>
          <span
            className={clsx(
              "inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold",
              bill.status === "finalized"
                ? "bg-green-100 text-green-700"
                : bill.status === "voided"
                  ? "bg-red-100 text-red-700"
                  : "bg-amber-100 text-amber-700",
            )}
          >
            {t(`common.${bill.status}` as Parameters<typeof t>[0])}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
            value={t(`common.${bill.paymentMethod}` as Parameters<typeof t>[0])}
          />
          <DetailField
            label={t("bills.phone")}
            value={bill.customerPhone || "—"}
          />
          <DetailField
            label={t("bills.netTotal")}
            value={formatCurrency(netTotal, currency)}
          />
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {t("bills.actions")}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {t("bills.actionsDesc")}
            </p>
          </div>
          <Button
            type="button"
            variant="danger"
            disabled={!canVoid}
            onClick={() => setVoidOpen(true)}
          >
            {t("bills.voidBill")}
          </Button>
        </div>
        {!canVoid && bill.status !== "voided" && (
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
            {t("bills.voidOnlyFinalized")}
          </p>
        )}
      </Card>

      <Card padding="sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[780px]">
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
                  <th
                    key={h}
                    className="px-3 py-3 text-start text-xs font-semibold text-slate-500 uppercase tracking-wide"
                  >
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
                    className="hover:bg-slate-50/50 transition-colors"
                  >
                    <td className="px-3 py-2.5 text-slate-600 tabular-nums font-mono text-xs">
                      {item.barcodeAtSale}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-800">
                      {item.productNameAtSale}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {item.categoryAtSale}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-700">
                      {item.quantitySold}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-700">
                      {item.quantityReturned ?? 0}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-600">
                      {formatCurrency(item.unitBuyPriceAtSale, currency)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-700">
                      {formatCurrency(item.unitSellPriceAtSale, currency)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums font-semibold text-slate-800">
                      {formatCurrency(item.lineSubtotal, currency)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-green-600 font-medium">
                      {formatCurrency(item.lineProfit, currency)}
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
        </div>
      </Card>

      <Card>
        <div className="max-w-xs ms-auto">
          <SummaryRow
            label={t("bills.subtotal")}
            value={formatCurrency(bill.subtotal, currency)}
          />
          <SummaryRow
            label={t("bills.discount")}
            value={formatCurrency(bill.discountAmount, currency)}
          />
          <SummaryRow
            label={t("bills.tax")}
            value={formatCurrency(bill.taxAmount, currency)}
          />
          <SummaryRow
            label={t("bills.total")}
            value={formatCurrency(bill.totalAmount, currency)}
            highlight
          />
          {(bill.returnedAmount ?? 0) > 0 && (
            <SummaryRow
              label={t("bills.returnedAmount")}
              value={`-${formatCurrency(bill.returnedAmount ?? 0, currency)}`}
            />
          )}
          <SummaryRow
            label={t("bills.netTotal")}
            value={formatCurrency(netTotal, currency)}
            highlight
          />
          <SummaryRow
            label={t("bills.paid")}
            value={formatCurrency(bill.paidAmount, currency)}
          />
          <SummaryRow
            label={t("bills.change")}
            value={formatCurrency(bill.changeAmount, currency)}
          />
          <SummaryRow
            label={t("bills.totalProfit")}
            value={formatCurrency(bill.totalProfit, currency)}
          />
          {(bill.returnedProfit ?? 0) > 0 && (
            <SummaryRow
              label={t("bills.returnedProfit")}
              value={`-${formatCurrency(bill.returnedProfit ?? 0, currency)}`}
            />
          )}
          <SummaryRow
            label={t("bills.netProfit")}
            value={formatCurrency(netProfit, currency)}
            highlight
          />
        </div>
        {bill.notes && (
          <p className="mt-4 pt-4 border-t border-slate-100 text-sm text-slate-500 whitespace-pre-line">
            <span className="font-medium text-slate-700">
              {t("bills.notes")}:
            </span>{" "}
            {bill.notes}
          </p>
        )}
      </Card>

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
        <label
          className="text-sm font-medium text-slate-700"
          htmlFor="void-reason"
        >
          {t("bills.voidReason")}
        </label>
        <textarea
          id="void-reason"
          value={voidReason}
          onChange={(event) => setVoidReason(event.target.value)}
          className="mt-2 w-full min-h-24 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={t("bills.reasonPlaceholder")}
        />
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
          <div>
            <label
              className="text-sm font-medium text-slate-700"
              htmlFor="return-quantity"
            >
              {t("bills.returnQuantity")}
            </label>
            <Input
              id="return-quantity"
              type="number"
              min="1"
              max={selectedRemaining}
              step="1"
              value={returnQuantity}
              onChange={(event) => setReturnQuantity(event.target.value)}
            />
          </div>
          <div>
            <label
              className="text-sm font-medium text-slate-700"
              htmlFor="return-reason"
            >
              {t("bills.returnReason")}
            </label>
            <textarea
              id="return-reason"
              value={returnReason}
              onChange={(event) => setReturnReason(event.target.value)}
              className="mt-2 w-full min-h-24 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("bills.reasonPlaceholder")}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

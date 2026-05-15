"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { summarizeShiftBills } from "@/lib/services/shift-service";
import { formatCurrency } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/date";
import { useLocale } from "@/components/providers/locale-context";
import { Button } from "@/components/ui/button";
import type { Bill, Settings, Shift } from "@/types/domain";

function Row({
  label,
  value,
  emphasis,
  tone,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: "positive" | "warning" | "neutral";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-700"
      : tone === "warning"
        ? "text-red-700"
        : "text-slate-900";
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span
        className={`text-sm ${emphasis ? "font-semibold text-slate-900" : "text-slate-500"}`}
      >
        {label}
      </span>
      <span
        className={`text-sm tabular-nums ${emphasis ? `font-bold ${toneClass}` : "font-medium text-slate-700"}`}
      >
        {value}
      </span>
    </div>
  );
}

export function ShiftReport({
  shift,
  settings,
}: {
  shift: Shift;
  settings?: Settings;
}) {
  const { t } = useLocale();
  const currency = settings?.currency ?? "USD";
  const storeName = settings?.storeName || "Shopkeeper POS";

  const bills = useLiveQuery<Bill[]>(
    () => db.bills.where("shiftId").equals(shift.id).toArray(),
    [shift.id],
  );
  const totals = summarizeShiftBills(bills ?? []);
  const expectedCash =
    shift.expectedCash ?? (shift.openingCash ?? 0) + totals.cashCollected;
  const countedCash = shift.countedCash ?? 0;
  const isClosed = shift.status === "closed";
  const difference = isClosed
    ? (shift.cashDifference ?? countedCash - expectedCash)
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <p className="text-xs text-slate-500">
          {isClosed
            ? t("shift.shiftStatusClosed")
            : t("shift.shiftStatusOpen")}
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => window.print()}
        >
          {t("bills.printReceipt")}
        </Button>
      </div>

      <div
        id="receipt-print-area"
        className="mx-auto w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm print:shadow-none print:border-0"
      >
        <div className="text-center border-b border-dashed border-slate-300 pb-3 mb-3">
          <p className="text-lg font-black tracking-tight">{storeName}</p>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
            {t("shift.activeShift")}
          </p>
        </div>

        <div className="space-y-1 text-xs text-slate-600 border-b border-dashed border-slate-300 pb-3 mb-3">
          <Row
            label={t("shift.openedAt")}
            value={formatDateTime(shift.openedAt)}
          />
          {shift.closedAt && (
            <Row
              label={t("shift.shiftStatusClosed")}
              value={formatDateTime(shift.closedAt)}
            />
          )}
          <Row label={t("shift.openedBy")} value={shift.openedByCashierName} />
        </div>

        <div className="space-y-1 border-b border-dashed border-slate-300 pb-3 mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
            {t("shift.cashCollected")}
          </p>
          <Row
            label={t("shift.cashCollected")}
            value={formatCurrency(totals.cashCollected, currency)}
          />
          <Row
            label={t("shift.cardCollected")}
            value={formatCurrency(totals.cardCollected, currency)}
          />
          <Row
            label={t("shift.creditAccrued")}
            value={formatCurrency(totals.creditAccrued, currency)}
          />
        </div>

        <div className="space-y-1 border-b border-dashed border-slate-300 pb-3 mb-3">
          <Row
            label={t("shift.openingCash")}
            value={formatCurrency(shift.openingCash, currency)}
          />
          <Row
            label={t("shift.expectedCash")}
            value={formatCurrency(expectedCash, currency)}
            emphasis
          />
          {isClosed && (
            <>
              <Row
                label={t("shift.countedCash")}
                value={formatCurrency(countedCash, currency)}
                emphasis
              />
              <Row
                label={t("shift.cashDifference")}
                value={formatCurrency(difference, currency)}
                emphasis
                tone={
                  difference > 0.005
                    ? "positive"
                    : difference < -0.005
                      ? "warning"
                      : "neutral"
                }
              />
            </>
          )}
        </div>

        <div className="space-y-1 border-b border-dashed border-slate-300 pb-3 mb-3">
          <Row
            label={t("shift.billsInShift")}
            value={String(totals.billCount)}
          />
          <Row
            label={t("shift.itemsInShift")}
            value={String(totals.itemCount)}
          />
          {totals.voidedBillCount > 0 && (
            <Row
              label={t("shift.voidedCount")}
              value={String(totals.voidedBillCount)}
            />
          )}
          {totals.returnedBillCount > 0 && (
            <Row
              label={t("shift.returnedCount")}
              value={String(totals.returnedBillCount)}
            />
          )}
        </div>

        {(shift.notes || shift.closingNotes) && (
          <div className="space-y-1 text-xs text-slate-600">
            {shift.notes && (
              <p>
                <span className="font-semibold">{t("shift.openShiftNotes")}:</span>{" "}
                {shift.notes}
              </p>
            )}
            {shift.closingNotes && (
              <p>
                <span className="font-semibold">{t("shift.closingNotes")}:</span>{" "}
                {shift.closingNotes}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

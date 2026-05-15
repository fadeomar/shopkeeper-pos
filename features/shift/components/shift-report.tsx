"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { summarizeShiftBills } from "@/lib/services/shift-service";
import { formatCurrency } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/date";
import { useLocale } from "@/components/providers/locale-context";
import type { Settings, Shift } from "@/types/domain";

/**
 * Stub component. D6 replaces this with the full printable report.
 * Left as a small inline summary so the close-shift flow has something
 * meaningful to show immediately after the action completes.
 */
export function ShiftReport({
  shift,
  settings,
}: {
  shift: Shift;
  settings?: Settings;
}) {
  const { t } = useLocale();
  const currency = settings?.currency ?? "USD";
  const bills = useLiveQuery(
    () => db.bills.where("shiftId").equals(shift.id).toArray(),
    [shift.id],
  );
  const totals = summarizeShiftBills(bills ?? []);
  const expectedCash = (shift.openingCash ?? 0) + totals.cashCollected;
  const difference =
    shift.cashDifference ?? (shift.countedCash ?? 0) - expectedCash;

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs text-slate-500">{t("shift.openedAt")}</p>
          <p className="font-medium">{formatDateTime(shift.openedAt)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">{t("shift.openedBy")}</p>
          <p className="font-medium">{shift.openedByCashierName}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">{t("shift.openingCash")}</p>
          <p className="font-semibold tabular-nums">
            {formatCurrency(shift.openingCash, currency)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">{t("shift.cashCollected")}</p>
          <p className="font-semibold tabular-nums">
            {formatCurrency(totals.cashCollected, currency)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">{t("shift.expectedCash")}</p>
          <p className="font-semibold tabular-nums">
            {formatCurrency(expectedCash, currency)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">{t("shift.countedCash")}</p>
          <p className="font-semibold tabular-nums">
            {formatCurrency(shift.countedCash ?? 0, currency)}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 px-3 py-2">
        <p className="text-xs text-slate-500">{t("shift.cashDifference")}</p>
        <p
          className={`text-lg font-bold tabular-nums ${
            difference > 0.005
              ? "text-emerald-700"
              : difference < -0.005
                ? "text-red-700"
                : "text-slate-700"
          }`}
        >
          {formatCurrency(difference, currency)}
        </p>
      </div>

      {shift.closingNotes && (
        <p className="text-xs text-slate-500 italic">
          {t("shift.closingNotes")}: {shift.closingNotes}
        </p>
      )}
    </div>
  );
}

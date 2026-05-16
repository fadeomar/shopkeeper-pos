"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { summarizeShiftBills } from "@/lib/services/shift-service";
import { formatDateTime } from "@/lib/utils/date";
import { useLocale } from "@/components/providers/locale-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import { PriceDisplay } from "@/components/pos/price-display";
import { dividerClasses, typographyClasses } from "@/lib/design/variants";
import type { Bill, Settings, Shift } from "@/types/domain";
import type { ReactNode } from "react";

function Row({
  label,
  value,
  emphasis,
  tone,
}: {
  label: string;
  value: ReactNode;
  emphasis?: boolean;
  tone?: "success" | "danger" | "neutral";
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span
        className={
          emphasis
            ? "text-sm font-semibold text-slate-900"
            : "text-sm text-slate-500"
        }
      >
        {label}
      </span>
      <span
        className={
          emphasis
            ? "text-sm font-bold tabular-nums text-slate-900"
            : "text-sm font-medium tabular-nums text-slate-700"
        }
      >
        {tone && tone !== "neutral" ? (
          <Badge tone={tone}>{value}</Badge>
        ) : (
          value
        )}
      </span>
    </div>
  );
}

function ReceiptSection({
  children,
  label,
}: {
  children: ReactNode;
  label?: ReactNode;
}) {
  return (
    <div
      className={`mb-3 space-y-1 border-b border-dashed pb-3 ${dividerClasses.borderDefault}`}
    >
      {label && (
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </p>
      )}
      {children}
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
        <StatusPill
          status={isClosed ? "shiftClosed" : "shiftOpen"}
          label={
            isClosed ? t("shift.shiftStatusClosed") : t("shift.shiftStatusOpen")
          }
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => window.print()}
        >
          {t("bills.printReceipt")}
        </Button>
      </div>

      <SectionCard
        padding="sm"
        className="mx-auto w-full max-w-sm print:border-0 print:shadow-none"
      >
        <div id="receipt-print-area" className="text-slate-900">
          <div
            className={`mb-3 border-b border-dashed pb-3 text-center ${dividerClasses.borderDefault}`}
          >
            <p className="text-lg font-black tracking-tight">{storeName}</p>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              {t("shift.activeShift")}
            </p>
          </div>

          <ReceiptSection>
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
            <Row
              label={t("shift.openedBy")}
              value={shift.openedByCashierName}
            />
          </ReceiptSection>

          <ReceiptSection label={t("shift.cashCollected")}>
            <Row
              label={t("shift.cashCollected")}
              value={
                <PriceDisplay
                  value={totals.cashCollected}
                  currency={currency}
                />
              }
            />
            <Row
              label={t("shift.cardCollected")}
              value={
                <PriceDisplay
                  value={totals.cardCollected}
                  currency={currency}
                />
              }
            />
            <Row
              label={t("shift.creditAccrued")}
              value={
                <PriceDisplay
                  value={totals.creditAccrued}
                  currency={currency}
                />
              }
            />
          </ReceiptSection>

          <ReceiptSection>
            <Row
              label={t("shift.openingCash")}
              value={
                <PriceDisplay value={shift.openingCash} currency={currency} />
              }
            />
            <Row
              label={t("shift.expectedCash")}
              value={
                <PriceDisplay
                  value={expectedCash}
                  currency={currency}
                  emphasis
                />
              }
              emphasis
            />
            {isClosed && (
              <>
                <Row
                  label={t("shift.countedCash")}
                  value={
                    <PriceDisplay
                      value={countedCash}
                      currency={currency}
                      emphasis
                    />
                  }
                  emphasis
                />
                <Row
                  label={t("shift.cashDifference")}
                  value={
                    <PriceDisplay
                      value={difference}
                      currency={currency}
                      emphasis
                    />
                  }
                  emphasis
                  tone={
                    difference > 0.005
                      ? "success"
                      : difference < -0.005
                        ? "danger"
                        : "neutral"
                  }
                />
              </>
            )}
          </ReceiptSection>

          <ReceiptSection>
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
          </ReceiptSection>

          {(shift.notes || shift.closingNotes) && (
            <div className={typographyClasses.hint}>
              {shift.notes && (
                <p>
                  <span className="font-semibold">
                    {t("shift.openShiftNotes")}:
                  </span>{" "}
                  {shift.notes}
                </p>
              )}
              {shift.closingNotes && (
                <p>
                  <span className="font-semibold">
                    {t("shift.closingNotes")}:
                  </span>{" "}
                  {shift.closingNotes}
                </p>
              )}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

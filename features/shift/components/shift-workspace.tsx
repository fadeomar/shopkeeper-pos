"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import {
  closeShift,
  computeExpectedCash,
  getActiveShift,
  listShifts,
  openShift,
  summarizeShiftBills,
  summarizeShiftCashOut,
} from "@/lib/services/shift-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import { TableShell } from "@/components/ui/table-shell";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import { PriceDisplay } from "@/components/pos/price-display";
import { formatCurrency } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/date";
import { typographyClasses } from "@/lib/design/variants";
import { ShiftReport } from "./shift-report";
import type {
  Bill,
  CustomerPayment,
  Purchase,
  Shift,
  SupplierPayment,
} from "@/types/domain";

function dismissOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") {
    e.preventDefault();
    e.currentTarget.blur();
  }
}

function ShiftStatCard({
  label,
  value,
  helper,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <SectionCard
      tone={tone}
      padding="sm"
      className="min-h-[104px] justify-between"
    >
      <div>
        <p className={typographyClasses.statLabel}>{label}</p>
        <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
          {value}
        </div>
      </div>
      {helper && <p className={typographyClasses.statHelper}>{helper}</p>}
    </SectionCard>
  );
}

function MoneyStat({
  label,
  value,
  currency,
  helper,
  tone,
}: {
  label: string;
  value: number;
  currency: string;
  helper?: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <ShiftStatCard
      label={label}
      value={
        <PriceDisplay value={value} currency={currency} size="xl" emphasis />
      }
      helper={helper}
      tone={tone}
    />
  );
}

export function ShiftWorkspace() {
  const { t, dir } = useLocale();
  const { push } = useToast();
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const activeShift = useLiveQuery(() => getActiveShift(), []);
  const pastShifts = useLiveQuery(() => listShifts(), []);
  // Live-queries on bills so the active-shift expected cash updates as new
  // sales come in. Filter to the active shift's id when it exists.
  const activeShiftBills = useLiveQuery<Bill[]>(
    () =>
      activeShift?.id
        ? db.bills.where("shiftId").equals(activeShift.id).toArray()
        : Promise.resolve<Bill[]>([]),
    [activeShift?.id],
  );
  const activeShiftPurchases = useLiveQuery<Purchase[]>(
    () =>
      activeShift?.id
        ? db.purchases.where("shiftId").equals(activeShift.id).toArray()
        : Promise.resolve<Purchase[]>([]),
    [activeShift?.id],
  );
  const activeShiftSupplierPayments = useLiveQuery<SupplierPayment[]>(
    () =>
      activeShift?.id
        ? db.supplierPayments.where("shiftId").equals(activeShift.id).toArray()
        : Promise.resolve<SupplierPayment[]>([]),
    [activeShift?.id],
  );
  const activeShiftCustomerPayments = useLiveQuery<CustomerPayment[]>(
    () =>
      activeShift?.id
        ? db.customerPayments.where("shiftId").equals(activeShift.id).toArray()
        : Promise.resolve<CustomerPayment[]>([]),
    [activeShift?.id],
  );
  const currency = settings?.currency ?? "USD";

  const [openingCash, setOpeningCash] = useState("");
  const [openNotes, setOpenNotes] = useState("");
  const [cashierName, setCashierName] = useState("");
  const [submittingOpen, setSubmittingOpen] = useState(false);

  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [submittingClose, setSubmittingClose] = useState(false);

  const [reportShift, setReportShift] = useState<Shift | null>(null);

  const totals = useMemo(
    () => summarizeShiftBills(activeShiftBills ?? []),
    [activeShiftBills],
  );
  const cashOut = useMemo(
    () =>
      summarizeShiftCashOut(
        activeShiftPurchases ?? [],
        activeShiftSupplierPayments ?? [],
      ),
    [activeShiftPurchases, activeShiftSupplierPayments],
  );

  const customerPaymentCashIn = useMemo(() => {
    return (activeShiftCustomerPayments ?? [])
      .filter((p) => !p.paymentMethod || p.paymentMethod === "cash")
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  }, [activeShiftCustomerPayments]);

  const expectedCash = activeShift
    ? (activeShift.openingCash ?? 0) +
      totals.cashCollected +
      customerPaymentCashIn -
      cashOut.totalCashOut
    : 0;

  // Used inside the close dialog to show live counted vs expected diff while
  // the cashier is typing.
  const countedCashNumeric = Number(countedCash);
  const liveDifference = Number.isFinite(countedCashNumeric)
    ? countedCashNumeric - expectedCash
    : 0;

  const closedShifts = (pastShifts ?? []).filter((s) => s.status === "closed");

  async function handleOpenShift() {
    if (submittingOpen) return;
    setSubmittingOpen(true);
    try {
      await openShift({
        openingCash: Number(openingCash || 0),
        cashierName: (cashierName || settings?.cashierName || "Owner").trim(),
        notes: openNotes,
      });
      setOpeningCash("");
      setOpenNotes("");
      setCashierName("");
      push(t("shift.openShiftSuccess"));
    } catch (error) {
      push(
        error instanceof Error ? error.message : t("shift.openShiftFailed"),
        "error",
      );
    } finally {
      setSubmittingOpen(false);
    }
  }

  async function handleCloseShift() {
    if (!activeShift || submittingClose) return;
    setSubmittingClose(true);
    try {
      const closed = await closeShift({
        shiftId: activeShift.id,
        countedCash: Number(countedCash || 0),
        notes: closingNotes,
      });
      setCloseDialogOpen(false);
      setCountedCash("");
      setClosingNotes("");
      push(t("shift.closeShiftSuccess"));
      setReportShift(closed);
    } catch (error) {
      push(
        error instanceof Error ? error.message : t("shift.closeShiftFailed"),
        "error",
      );
    } finally {
      setSubmittingClose(false);
    }
  }

  return (
    <div className="space-y-5" dir={dir}>
      {activeShift === undefined ? (
        <LoadingState title={t("common.loading")} />
      ) : activeShift === null ? (
        // ── No active shift: show the open-shift form ──────────────────
        <SectionCard
          title={t("shift.noActiveShift")}
          description={t("shift.noActiveShiftDesc")}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              label={t("shift.openingCash")}
              hint={t("shift.openingCashHelper")}
            >
              <Input
                type="number"
                inputMode="decimal"
                enterKeyHint="done"
                step="0.01"
                min="0"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                onKeyDown={dismissOnEnter}
                placeholder="0.00"
              />
            </FormField>
            <FormField
              label={t("shift.cashierName")}
              hint={t("shift.cashierNameHelper")}
            >
              <Input
                value={cashierName}
                onChange={(e) => setCashierName(e.target.value)}
                placeholder={settings?.cashierName || "Owner"}
              />
            </FormField>
          </div>

          <FormField label={t("shift.openShiftNotes")}>
            <Input
              value={openNotes}
              onChange={(e) => setOpenNotes(e.target.value)}
              placeholder={t("shift.openShiftNotesPlaceholder")}
            />
          </FormField>

          <div className="flex justify-end">
            <Button
              type="button"
              variant="success"
              onClick={handleOpenShift}
              disabled={submittingOpen}
              loading={submittingOpen}
            >
              {t("shift.openShiftCta")}
            </Button>
          </div>
        </SectionCard>
      ) : (
        // ── Active shift: live summary + close button ──────────────────
        <SectionCard
          title={
            <span className="inline-flex items-center gap-2">
              {t("shift.activeShift")}
              <StatusPill
                status="shiftOpen"
                label={t("shift.shiftStatusOpen")}
              />
            </span>
          }
          description={
            <>
              {t("shift.openedAt")}: {formatDateTime(activeShift.openedAt)} ·{" "}
              {t("shift.openedBy")}: {activeShift.openedByCashierName}
            </>
          }
          actions={
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setCountedCash(expectedCash.toFixed(2));
                setCloseDialogOpen(true);
              }}
            >
              {t("shift.closeShift")}
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MoneyStat
              label={t("shift.openingCash")}
              value={activeShift.openingCash}
              currency={currency}
            />
            <MoneyStat
              label={t("shift.cashCollected")}
              value={totals.cashCollected}
              currency={currency}
            />
            <MoneyStat
              label={t("shift.cashPaidOut")}
              value={cashOut.totalCashOut}
              currency={currency}
              helper={t("shift.cashPaidOutHelper")}
              tone={cashOut.totalCashOut > 0.005 ? "warning" : "neutral"}
            />
            <MoneyStat
              label={t("shift.expectedCash")}
              value={expectedCash}
              currency={currency}
              helper={t("shift.expectedCashHelper")}
              tone="success"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ShiftStatCard
              label={t("shift.billsInShift")}
              value={String(totals.billCount)}
            />
            <ShiftStatCard
              label={t("shift.itemsInShift")}
              value={String(totals.itemCount)}
            />
            <ShiftStatCard
              label={t("shift.purchasesInShift")}
              value={String(cashOut.purchaseCount)}
              helper={
                <PriceDisplay
                  value={cashOut.purchaseCashOut}
                  currency={currency}
                  size="sm"
                />
              }
            />
            <ShiftStatCard
              label={t("shift.paymentsInShift")}
              value={String(cashOut.supplierPaymentCount)}
              helper={
                <PriceDisplay
                  value={cashOut.supplierPaymentCashOut}
                  currency={currency}
                  size="sm"
                />
              }
            />
          </div>

          {(totals.voidedBillCount > 0 || totals.returnedBillCount > 0) && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MoneyStat
                label={t("shift.creditAccrued")}
                value={totals.creditAccrued}
                currency={currency}
              />
              <ShiftStatCard
                label={t("shift.voidedCount")}
                value={String(totals.voidedBillCount)}
                tone="warning"
              />
              <ShiftStatCard
                label={t("shift.returnedCount")}
                value={String(totals.returnedBillCount)}
                tone="warning"
              />
            </div>
          )}

          {activeShift.notes && (
            <p className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs italic text-slate-500">
              &ldquo;{activeShift.notes}&rdquo;
            </p>
          )}
        </SectionCard>
      )}

      {/* ── Past shifts history ────────────────────────────────────────── */}
      <TableShell
        title={t("shift.history")}
        description={t("shift.historyDesc")}
        loading={pastShifts === undefined}
        empty={
          closedShifts.length === 0 ? (
            <EmptyState
              title={t("shift.noPastShifts")}
              description={t("shift.historyDesc")}
              compact
            />
          ) : undefined
        }
      >
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {[
                t("shift.openedAt"),
                t("shift.openedBy"),
                t("shift.openingCash"),
                t("shift.expectedCash"),
                t("shift.countedCash"),
                t("shift.cashDifference"),
                "",
              ].map((h) => (
                <th key={h} className={typographyClasses.tableHeader}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {closedShifts.map((shift) => {
              const diff = shift.cashDifference ?? 0;
              return (
                <tr key={shift.id} className="hover:bg-slate-50/60">
                  <td className={typographyClasses.tableCell}>
                    {formatDateTime(shift.openedAt)}
                  </td>
                  <td className={typographyClasses.tableCell}>
                    {shift.openedByCashierName}
                  </td>
                  <td className={typographyClasses.tableCell}>
                    <PriceDisplay
                      value={shift.openingCash}
                      currency={currency}
                    />
                  </td>
                  <td className={typographyClasses.tableCell}>
                    <PriceDisplay
                      value={shift.expectedCash ?? 0}
                      currency={currency}
                    />
                  </td>
                  <td className={typographyClasses.tableCell}>
                    <PriceDisplay
                      value={shift.countedCash ?? 0}
                      currency={currency}
                    />
                  </td>
                  <td className={typographyClasses.tableCell}>
                    <Badge
                      tone={
                        diff > 0.005
                          ? "success"
                          : diff < -0.005
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {formatCurrency(diff, currency)}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setReportShift(shift)}
                    >
                      {t("shift.viewReport")}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableShell>

      {/* ── Close-shift dialog ────────────────────────────────────────── */}
      <Modal
        open={closeDialogOpen}
        title={t("shift.closeShift")}
        description={t("shift.closeShiftDesc")}
        onClose={() => setCloseDialogOpen(false)}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCloseDialogOpen(false)}
              disabled={submittingClose}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="warning"
              onClick={handleCloseShift}
              disabled={submittingClose}
              loading={submittingClose}
            >
              {t("shift.confirmClose")}
            </Button>
          </>
        }
      >
        {activeShift && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <MoneyStat
                label={t("shift.expectedCash")}
                value={expectedCash}
                currency={currency}
              />
              <MoneyStat
                label={t("shift.cashDifference")}
                value={liveDifference}
                currency={currency}
                tone={
                  liveDifference > 0.005
                    ? "success"
                    : liveDifference < -0.005
                      ? "danger"
                      : "neutral"
                }
              />
            </div>
            <FormField
              label={t("shift.countedCash")}
              hint={t("shift.countedCashHelper")}
            >
              <Input
                type="number"
                inputMode="decimal"
                enterKeyHint="done"
                step="0.01"
                min="0"
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                onKeyDown={dismissOnEnter}
              />
            </FormField>
            <FormField label={t("shift.closingNotes")}>
              <Input
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
              />
            </FormField>
          </div>
        )}
      </Modal>

      {/* ── Shift report viewer ───────────────────────────────────────── */}
      <Modal
        open={reportShift !== null}
        title={t("shift.viewReport")}
        onClose={() => setReportShift(null)}
        footer={
          <Button
            type="button"
            variant="ghost"
            onClick={() => setReportShift(null)}
          >
            {t("common.close")}
          </Button>
        }
      >
        {reportShift && <ShiftReport shift={reportShift} settings={settings} />}
      </Modal>
    </div>
  );
}

// Stub re-export so the route file can import a single name even before the
// real report lands (D6 fills it in). Keeps the workspace import stable.
export { computeExpectedCash };

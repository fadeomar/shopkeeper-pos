"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { ColumnDef } from "@tanstack/react-table";
import { settingsRepo } from "@/lib/db/repositories";
import {
  listCashMovements,
  recordCashMovement,
} from "@/lib/services/cash-movement-service";
import { getActiveShift } from "@/lib/services/shift-service";
import type { CashMovement, CashMovementType } from "@/types/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, useDataTableLabels } from "@/components/ui/data-table";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import { formatCurrency, MONEY_EPSILON, roundMoney } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/date";
import { getServiceErrorMessage } from "@/lib/errors/get-error-message";

const TYPE_OPTIONS: CashMovementType[] = [
  "cash_in",
  "cash_out",
  "owner_withdrawal",
  "bank_deposit",
  "petty_cash",
  "drawer_correction",
];

function typeKey(t: CashMovementType): string {
  // Snake_case → camelCase, then prefix with cash.type
  const camel = t.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
  return `cash.type${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

const INFLOW_TYPES: CashMovementType[] = ["cash_in"];
const OUTFLOW_TYPES: CashMovementType[] = [
  "cash_out",
  "owner_withdrawal",
  "bank_deposit",
  "petty_cash",
];

function directionFor(type: CashMovementType): "in" | "out" | "signed" {
  if (INFLOW_TYPES.includes(type)) return "in";
  if (OUTFLOW_TYPES.includes(type)) return "out";
  return "signed";
}

export function CashWorkspace() {
  const { t } = useLocale();
  const tableLabels = useDataTableLabels();
  const { push } = useToast();

  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const activeShift = useLiveQuery(() => getActiveShift(), []);
  const movements = useLiveQuery(
    () => listCashMovements({}),
    [],
    [] as CashMovement[],
  );
  const currency = settings?.currency ?? "₪";

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<CashMovementType>("cash_in");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [referenceLabel, setReferenceLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const totals = useMemo(() => {
    const cashIn = movements
      .filter((m) => m.amount > 0)
      .reduce((sum, m) => sum + m.amount, 0);
    const cashOut = movements
      .filter((m) => m.amount < 0)
      .reduce((sum, m) => sum + m.amount, 0);
    return {
      cashIn: roundMoney(cashIn),
      cashOut: roundMoney(Math.abs(cashOut)),
      net: roundMoney(cashIn + cashOut),
    };
  }, [movements]);

  function resetForm() {
    setType("cash_in");
    setAmount("");
    setReason("");
    setReferenceLabel("");
  }

  async function handleSave() {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || Math.abs(numeric) < MONEY_EPSILON) {
      push(t("common.invalidAmount"), "error");
      return;
    }
    setSaving(true);
    try {
      await recordCashMovement({
        type,
        amount: numeric,
        reason: reason.trim() || undefined,
        referenceLabel: referenceLabel.trim() || undefined,
        cashierName: settings?.cashierName,
      });
      push(t("cash.saved"));
      setOpen(false);
      resetForm();
    } catch (error) {
      push(getServiceErrorMessage(error, t, t("cash.saveFailed")), "error");
    } finally {
      setSaving(false);
    }
  }

  const direction = directionFor(type);

  const columns = useMemo<ColumnDef<CashMovement, unknown>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: t("cash.colTime"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-slate-600">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        accessorKey: "type",
        header: t("cash.colType"),
        cell: ({ row }) => (
          <span className="text-xs font-medium text-slate-700">
            {t(typeKey(row.original.type))}
          </span>
        ),
      },
      {
        accessorKey: "amount",
        header: t("cash.colAmount"),
        cell: ({ row }) => (
          <span
            className={`font-semibold tabular-nums ${row.original.amount >= 0 ? "text-emerald-700" : "text-red-700"}`}
            dir="ltr"
          >
            {row.original.amount >= 0 ? "+" : ""}
            {formatCurrency(row.original.amount, currency)}
          </span>
        ),
      },
      {
        accessorKey: "reason",
        header: t("cash.colReason"),
        cell: ({ row }) => (
          <span className="text-xs text-slate-600">
            {row.original.reason ?? "—"}
            {row.original.referenceLabel && (
              <span className="block text-[10px] text-slate-400">
                {row.original.referenceLabel}
              </span>
            )}
          </span>
        ),
      },
      {
        accessorKey: "shiftId",
        header: t("cash.colShift"),
        cell: ({ row }) => (
          <span className="font-mono text-[10px] text-slate-400">
            {row.original.shiftId ?? "—"}
          </span>
        ),
      },
    ],
    [t, currency],
  );

  return (
    <PageShell>
      <PageHeader
        title={t("cash.title")}
        description={t("cash.subtitle")}
        actions={
          <Button type="button" onClick={() => setOpen(true)}>
            {t("cash.addButton")}
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={t("cash.cashInTotal")}
          value={formatCurrency(totals.cashIn, currency)}
          tone="positive"
        />
        <StatCard
          label={t("cash.cashOutTotal")}
          value={formatCurrency(totals.cashOut, currency)}
          tone="warning"
        />
        <StatCard
          label={t("cash.netToday")}
          value={`${totals.net >= 0 ? "+" : ""}${formatCurrency(totals.net, currency)}`}
          tone={totals.net >= 0 ? "positive" : "warning"}
        />
      </div>

      {movements.length === 0 ? (
        <EmptyState title={t("cash.empty")} description={t("cash.emptyDesc")} />
      ) : (
        <DataTable
          columns={columns}
          data={movements}
          labels={tableLabels}
          enableGlobalSearch={false}
        />
      )}

      <Modal
        open={open}
        onClose={() => (saving ? undefined : setOpen(false))}
        title={t("cash.confirmHeading")}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? t("cash.saving") : t("cash.save")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!activeShift && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t("cash.noActiveShiftLabel")}
            </p>
          )}
          {activeShift && (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <span className="font-medium">{t("cash.activeShiftLabel")}:</span>{" "}
              {activeShift.openedByCashierName}
            </p>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">{t("cash.type")}</span>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as CashMovementType)}
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(typeKey(option))}
                </option>
              ))}
            </Select>
            <span className="text-xs text-slate-500">
              {direction === "in" && t("cash.cashIn")}
              {direction === "out" && t("cash.cashOut")}
              {direction === "signed" && t("cash.drawerCorrectionHint")}
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">
              {t("cash.amount")}
            </span>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              dir="ltr"
            />
            <span className="text-xs text-slate-500">
              {t("cash.amountHelper")}
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">
              {t("cash.referenceLabel")}
            </span>
            <Input
              value={referenceLabel}
              onChange={(e) => setReferenceLabel(e.target.value)}
            />
            <span className="text-xs text-slate-500">
              {t("cash.referenceLabelHelper")}
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">
              {t("cash.reason")}
            </span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
      </Modal>
    </PageShell>
  );
}

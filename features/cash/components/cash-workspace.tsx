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
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
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
import { blurInputOnEnter } from "@/lib/utils/dismiss-on-enter";
import { getServiceErrorMessage } from "@/lib/errors/get-error-message";
import { RecordSyncBadge } from "@/components/sync/record-sync-badge";

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

const REASON_REQUIRED_TYPES: CashMovementType[] = [
  "cash_out",
  "owner_withdrawal",
  "bank_deposit",
  "petty_cash",
  "drawer_correction",
];

function requiresReason(type: CashMovementType): boolean {
  return REASON_REQUIRED_TYPES.includes(type);
}

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
  const currency = settings?.currency ?? "ILS";

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<CashMovementType>("cash_in");
  const [amount, setAmount] = useState<number>(0);
  const [reason, setReason] = useState("");
  const [referenceLabel, setReferenceLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | CashMovementType>("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      const date = m.createdAt.slice(0, 10);
      if (filterFrom && date < filterFrom) return false;
      if (filterTo && date > filterTo) return false;
      if (typeFilter !== "all" && m.type !== typeFilter) return false;
      if (actorFilter !== "all" && (m.cashierName || "") !== actorFilter) return false;
      if (shiftFilter !== "all" && (m.shiftId || "") !== shiftFilter) return false;
      return true;
    });
  }, [movements, typeFilter, actorFilter, shiftFilter, filterFrom, filterTo]);

  const actorOptions = useMemo(() => {
    const actors = new Set<string>();
    for (const movement of movements) {
      if (movement.cashierName) actors.add(movement.cashierName);
    }
    return Array.from(actors).sort();
  }, [filteredMovements]);

  const shiftOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const movement of movements) {
      if (movement.shiftId) ids.add(movement.shiftId);
    }
    return Array.from(ids).sort();
  }, [movements]);

  const totals = useMemo(() => {
    const cashIn = filteredMovements
      .filter((m) => m.amount > 0)
      .reduce((sum, m) => sum + m.amount, 0);
    const cashOut = filteredMovements
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
    setAmount(0);
    setReason("");
    setReferenceLabel("");
  }

  async function handleSave() {
    if (!Number.isFinite(amount) || Math.abs(amount) < MONEY_EPSILON) {
      push(t("common.invalidAmount"), "error");
      return;
    }
    if (requiresReason(type) && !reason.trim()) {
      push(t("cash.reasonRequired"), "error");
      return;
    }
    setSaving(true);
    try {
      await recordCashMovement({
        type,
        amount,
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
  const reasonIsRequired = requiresReason(type);

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
            className={`font-semibold tabular-nums ${row.original.amount >= 0 ? "text-success" : "text-danger"}`}
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
      {
        accessorKey: "syncStatus",
        header: t("sync.status"),
        cell: ({ row }) => <RecordSyncBadge status={row.original.syncStatus} />,
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

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            {t("cash.filterType")}
            <SearchableSelect
              value={typeFilter}
              onValueChange={(v) => setTypeFilter((v ?? "all") as "all" | CashMovementType)}
              options={[
                { value: "all", label: t("cash.allTypes") },
                ...TYPE_OPTIONS.map((option) => ({ value: option, label: t(typeKey(option)) })),
              ]}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            {t("cash.filterActor")}
            <SearchableSelect
              value={actorFilter}
              onValueChange={(v) => setActorFilter(v ?? "all")}
              options={[
                { value: "all", label: t("cash.allActors") },
                ...actorOptions.map((actor) => ({ value: actor, label: actor })),
              ]}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            {t("cash.filterShift")}
            <SearchableSelect
              value={shiftFilter}
              onValueChange={(v) => setShiftFilter(v ?? "all")}
              options={[
                { value: "all", label: t("cash.allShifts") },
                ...shiftOptions.map((id) => ({ value: id, label: id.slice(0, 8) })),
              ]}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            {t("cash.fromDate")}
            <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} dir="ltr" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            {t("cash.toDate")}
            <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} dir="ltr" />
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setTypeFilter("all");
              setActorFilter("all");
              setShiftFilter("all");
              setFilterFrom("");
              setFilterTo("");
            }}
          >
            {t("cash.resetFilters")}
          </Button>
        </div>
      </Card>

      {movements.length === 0 ? (
        <EmptyState title={t("cash.empty")} description={t("cash.emptyDesc")} />
      ) : (
        <DataTable
          columns={columns}
          data={filteredMovements}
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
        <div className="space-y-3" onKeyDown={blurInputOnEnter}>
          {!activeShift && (
            <p className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
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
            <SearchableSelect
              value={type}
              onValueChange={(v) => setType((v ?? "cash_in") as CashMovementType)}
              options={TYPE_OPTIONS.map((option) => ({
                value: option,
                label: t(typeKey(option)),
              }))}
            />
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
            <MoneyInput
              value={amount}
              onValueChange={setAmount}
              currency={currency}
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
              {reasonIsRequired && <span className="text-danger"> *</span>}
            </span>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-required={reasonIsRequired}
            />
            {reasonIsRequired && (
              <span className="text-xs text-slate-500">
                {t("cash.reasonRequiredHint")}
              </span>
            )}
          </label>
        </div>
      </Modal>
    </PageShell>
  );
}

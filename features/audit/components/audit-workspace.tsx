"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { ColumnDef } from "@tanstack/react-table";
import { db } from "@/lib/db/schema";
import { listAuditEvents } from "@/lib/services/audit-service";
import type { AuditAction, AuditCategory, AuditEvent } from "@/types/domain";
import { DataTable, useDataTableLabels } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useLocale } from "@/components/providers/locale-context";
import { formatDateTime } from "@/lib/utils/date";
import { downloadCSV } from "@/lib/utils/export-csv";
import { Button } from "@/components/ui/button";

const CATEGORIES: AuditCategory[] = [
  'product','inventory','bill','purchase','customer','supplier','settings','shift','cash','expense','user','sync',
];

const ACTIONS: AuditAction[] = [
  'create','update','delete','void','return','payment','stock_adjust','cash_in','cash_out','expense_create','open','close','approve','reject','deactivate','reactivate','reset_link','resolve_conflict','price_change',
];

function categoryKey(c: AuditCategory): string {
  return `audit.cat${c.charAt(0).toUpperCase()}${c.slice(1)}`;
}

function actionKey(a: AuditAction): string {
  // Snake_case → camelCase, then prefix.
  const camel = a.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
  return `audit.act${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

const CATEGORY_BADGE_TONE: Record<AuditCategory, string> = {
  product: 'bg-info-soft text-info ring-info/30',
  inventory: 'bg-warning-soft text-warning ring-warning/30',
  bill: 'bg-success-soft text-success ring-success/30',
  purchase: 'bg-warning-soft text-warning ring-warning/30',
  customer: 'bg-brand-soft text-brand ring-brand/25',
  supplier: 'bg-money-soft text-money ring-money/25',
  settings: 'bg-surface-soft text-fg-secondary ring-border-strong/50',
  shift: 'bg-info-soft text-info ring-info/25',
  cash: 'bg-success-soft text-success ring-success/30',
  expense: 'bg-danger-soft text-danger ring-danger/25',
  user: 'bg-danger-soft text-danger ring-danger/25',
  sync: 'bg-warning-soft text-warning ring-warning/20',
};

export function AuditWorkspace() {
  const { t } = useLocale();
  const tableLabels = useDataTableLabels();

  const [category, setCategory] = useState<AuditCategory | ''>('');
  const [action, setAction] = useState<AuditAction | ''>('');
  const [actor, setActor] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');

  // useLiveQuery re-runs the listAuditEvents call whenever auditEvents changes
  // OR when any of the filter inputs change. Dexie's table-level change
  // detection is fine here — the audit log is append-only and rarely huge.
  const events = useLiveQuery(
    () =>
      listAuditEvents({
        category: category || undefined,
        action: action || undefined,
        actor: actor || undefined,
        from: fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : undefined,
        to: toDate ? new Date(`${toDate}T23:59:59.999`).toISOString() : undefined,
        search: search || undefined,
      }),
    [category, action, actor, fromDate, toDate, search],
    [] as AuditEvent[],
  );

  const allEventsForActors = useLiveQuery(
    () => db.auditEvents.toArray(),
    [],
    [] as AuditEvent[],
  );

  // Whole-table count so the empty state distinguishes "no events ever" from
  // "no events match the current filter".
  const totalCount = useLiveQuery(() => db.auditEvents.count(), [], 0);


  const actorOptions = useMemo(() => {
    const actors = new Map<string, string>();
    for (const event of allEventsForActors) {
      const value = event.actorUid || event.actorName;
      if (!value) continue;
      const label = event.actorName || event.actorUid || value;
      actors.set(value, label);
    }
    return Array.from(actors.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allEventsForActors]);

  function exportAuditCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(
      events,
      [
        { header: t('audit.colTime'), value: (row) => row.createdAt },
        { header: t('audit.colCategory'), value: (row) => t(categoryKey(row.category)) },
        { header: t('audit.colAction'), value: (row) => t(actionKey(row.action)) },
        { header: t('audit.colEntity'), value: (row) => row.entityLabel ?? row.entityId ?? '' },
        { header: t('audit.colSummary'), value: (row) => row.summary ?? '' },
        { header: t('audit.colReason'), value: (row) => row.reason ?? '' },
        { header: t('audit.colActor'), value: (row) => row.actorName ?? row.actorUid ?? '' },
      ],
      `asas-audit-${stamp}.csv`,
    );
  }

  const columns = useMemo<ColumnDef<AuditEvent, unknown>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: t('audit.colTime'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-slate-600">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        accessorKey: 'category',
        header: t('audit.colCategory'),
        cell: ({ row }) => (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${CATEGORY_BADGE_TONE[row.original.category]}`}
          >
            {t(categoryKey(row.original.category))}
          </span>
        ),
      },
      {
        accessorKey: 'action',
        header: t('audit.colAction'),
        cell: ({ row }) => (
          <span className="text-xs font-medium text-slate-700">
            {t(actionKey(row.original.action))}
          </span>
        ),
      },
      {
        accessorKey: 'entityLabel',
        header: t('audit.colEntity'),
        cell: ({ row }) => (
          <span className="font-medium text-slate-800">
            {row.original.entityLabel ?? row.original.entityId ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'summary',
        header: t('audit.colSummary'),
        cell: ({ row }) => (
          <span className="text-sm text-slate-700">
            {row.original.summary ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'reason',
        header: t('audit.colReason'),
        cell: ({ row }) => (
          <span className="text-xs text-slate-500" title={row.original.reason}>
            {row.original.reason ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'actorName',
        header: t('audit.colActor'),
        cell: ({ row }) => (
          <span className="text-xs text-slate-500">
            {row.original.actorName ?? row.original.actorUid ?? '—'}
          </span>
        ),
      },
    ],
    [t],
  );

  return (
    <PageShell>
      <PageHeader
        title={t('audit.title')}
        description={t('audit.subtitle')}
        actions={
          <Button type="button" variant="secondary" onClick={exportAuditCsv} disabled={events.length === 0}>
            {t('reports.exportCsv')}
          </Button>
        }
      />

      <Card>
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-10">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600 xl:col-span-2">
            {t('audit.filterCategory')}
            <SearchableSelect
              value={category || null}
              onValueChange={(v) => setCategory((v ?? '') as AuditCategory | '')}
              clearable
              placeholder={t('audit.filterAllCategories')}
              options={[
                ...CATEGORIES.map((c) => ({ value: c, label: t(categoryKey(c)) })),
              ]}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600 xl:col-span-2">
            {t('audit.filterAction')}
            <SearchableSelect
              value={action || null}
              onValueChange={(v) => setAction((v ?? '') as AuditAction | '')}
              clearable
              placeholder={t('audit.filterAllActions')}
              options={[
                ...ACTIONS.map((a) => ({ value: a, label: t(actionKey(a)) })),
              ]}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600 xl:col-span-2">
            {t('audit.filterActor')}
            <SearchableSelect
              value={actor || null}
              onValueChange={(v) => setActor(v ?? '')}
              clearable
              placeholder={t('audit.filterAllActors')}
              options={actorOptions}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600 xl:col-span-2">
            {t('audit.fromDate')}
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600 xl:col-span-2">
            {t('audit.toDate')}
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600 sm:col-span-2 xl:col-span-8">
            {t('audit.filterSearch')}
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('audit.filterSearch')}
            />
          </label>
          <button
            type="button"
            onClick={() => { setCategory(''); setAction(''); setActor(''); setFromDate(''); setToDate(''); setSearch(''); }}
            className="min-h-[42px] self-end rounded-xl border border-border-default bg-surface-soft px-4 text-sm font-semibold text-slate-800 transition-colors hover:bg-surface-muted sm:col-span-2 xl:col-span-2"
          >
            {t('common.reset')}
          </button>
        </div>
      </Card>

      {(totalCount ?? 0) === 0 ? (
        <EmptyState
          title={t('audit.empty')}
          description={t('audit.emptyDesc')}
        />
      ) : (
        <DataTable
          columns={columns}
          data={events}
          labels={tableLabels}
          enableGlobalSearch={false}
        />
      )}
    </PageShell>
  );
}

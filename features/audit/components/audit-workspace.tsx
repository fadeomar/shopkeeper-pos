"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { ColumnDef } from "@tanstack/react-table";
import { db } from "@/lib/db/schema";
import { listAuditEvents } from "@/lib/services/audit-service";
import type { AuditAction, AuditCategory, AuditEvent } from "@/types/domain";
import { DataTable, useDataTableLabels } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useLocale } from "@/components/providers/locale-context";
import { formatDateTime } from "@/lib/utils/date";

const CATEGORIES: AuditCategory[] = [
  'product','inventory','bill','purchase','customer','supplier','settings','shift','user','sync',
];

const ACTIONS: AuditAction[] = [
  'create','update','delete','void','return','payment','stock_adjust','open','close','approve','reject','deactivate','reactivate','reset_link','resolve_conflict','price_change',
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
  product: 'bg-blue-50 text-blue-700 ring-blue-200',
  inventory: 'bg-amber-50 text-amber-800 ring-amber-200',
  bill: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  purchase: 'bg-violet-50 text-violet-700 ring-violet-200',
  customer: 'bg-sky-50 text-sky-700 ring-sky-200',
  supplier: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
  settings: 'bg-slate-50 text-slate-700 ring-slate-200',
  shift: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  user: 'bg-rose-50 text-rose-700 ring-rose-200',
  sync: 'bg-orange-50 text-orange-700 ring-orange-200',
};

export function AuditWorkspace() {
  const { t } = useLocale();
  const tableLabels = useDataTableLabels();

  const [category, setCategory] = useState<AuditCategory | ''>('');
  const [action, setAction] = useState<AuditAction | ''>('');
  const [search, setSearch] = useState('');

  // useLiveQuery re-runs the listAuditEvents call whenever auditEvents changes
  // OR when any of the filter inputs change. Dexie's table-level change
  // detection is fine here — the audit log is append-only and rarely huge.
  const events = useLiveQuery(
    () =>
      listAuditEvents({
        category: category || undefined,
        action: action || undefined,
        search: search || undefined,
      }),
    [category, action, search],
    [] as AuditEvent[],
  );

  // Whole-table count so the empty state distinguishes "no events ever" from
  // "no events match the current filter".
  const totalCount = useLiveQuery(() => db.auditEvents.count(), [], 0);

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
      <PageHeader title={t('audit.title')} description={t('audit.subtitle')} />

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:w-48">
            {t('audit.filterCategory')}
            <Select value={category} onChange={(e) => setCategory(e.target.value as AuditCategory | '')}>
              <option value="">{t('audit.filterAllCategories')}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(categoryKey(c))}</option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:w-48">
            {t('audit.filterAction')}
            <Select value={action} onChange={(e) => setAction(e.target.value as AuditAction | '')}>
              <option value="">{t('audit.filterAllActions')}</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>{t(actionKey(a))}</option>
              ))}
            </Select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
            {t('audit.filterSearch')}
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('audit.filterSearch')}
            />
          </label>
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

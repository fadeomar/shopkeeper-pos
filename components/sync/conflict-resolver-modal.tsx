'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Badge } from '@/components/ui/badge';
import { useLocale } from '@/components/providers/locale-context';
import { db } from '@/lib/db/schema';
import { formatDateTime } from '@/lib/utils/date';
import { getOpenConflicts, resolveConflictWithAction } from '@/lib/services/sync-conflict-service';
import type { StockMovement, SyncConflict, SyncEntity } from '@/types/domain';

// Map a sync entity to a friendly, translated label so the conflict screen
// reads naturally for cashiers/admins in Arabic + English (never raw
// "billItemCostAllocation").
function getConflictEntityLabel(
  entity: SyncEntity,
  t: ReturnType<typeof useLocale>['t'],
): string {
  switch (entity) {
    case 'product': return t('sync.entityProduct');
    case 'customer': return t('sync.entityCustomer');
    case 'supplier': return t('sync.entitySupplier');
    case 'bill': return t('sync.entityBill');
    case 'purchase': return t('sync.entityPurchase');
    case 'inventoryLot': return t('sync.entityInventoryLot');
    case 'billItemCostAllocation': return t('sync.entityBillItemCostAllocation');
    case 'stockMovement': return t('sync.entityStockMovement');
    case 'settings': return t('sync.entitySettings');
    case 'shift': return t('sync.entityShift');
    default: return t('sync.entityRecord');
  }
}

// camelCase / snake_case field name → human "Title Case" label.
function humanizeField(field: string): string {
  const spaced = field
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Render a record value as a short, readable string for the diff table.
function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  const json = JSON.stringify(value);
  return json.length > 80 ? `${json.slice(0, 79)}…` : json;
}

function getRecordLabel(conflict: SyncConflict): string {
  const source = { ...conflict.cloudRecord, ...conflict.localRecord } as Record<string, unknown>;
  const label =
    source.name ??
    source.productName ??
    source.sku ??
    source.barcode ??
    source.billNumber ??
    source.purchaseNumber ??
    source.storeName ??
    conflict.entityId;
  return String(label || conflict.entityId);
}

function getRecordMeta(conflict: SyncConflict): string[] {
  const source = { ...conflict.cloudRecord, ...conflict.localRecord } as Record<string, unknown>;
  const parts: string[] = [];
  if (source.sku) parts.push(`SKU ${String(source.sku)}`);
  if (source.barcode) parts.push(`Barcode ${String(source.barcode)}`);
  if (source.category) parts.push(String(source.category));
  if (source.updatedAt || source.lastUpdated) {
    parts.push(`Updated ${formatDateTime(String(source.updatedAt ?? source.lastUpdated))}`);
  }
  return parts;
}

function getConflictMeaning(conflict: SyncConflict): string {
  if (conflict.entity === 'product' && conflict.changedFields.includes('quantityInStock')) {
    return 'Stock changed on this device and in the cloud before sync finished. Use the timestamps and recent stock movements below to decide which stock count is the real one.';
  }
  if (conflict.entity === 'product' && conflict.changedFields.some((field) => field.toLowerCase().includes('price'))) {
    return 'Product price details changed in more than one place. Keep the value that matches the latest real purchase or sale decision.';
  }
  if (conflict.entity === 'settings') {
    return 'Store settings changed locally and in the cloud. Keep the version that should be used by this store going forward.';
  }
  return 'This record was updated in more than one place before sync finished. Compare the values before choosing a version.';
}

type ConflictViewModel = {
  conflict: SyncConflict;
  movements: StockMovement[];
};

async function getConflictViewModels(): Promise<ConflictViewModel[]> {
  const conflicts = await getOpenConflicts();
  return Promise.all(
    conflicts.map(async (conflict) => {
      if (conflict.entity !== 'product') return { conflict, movements: [] };
      const movements = await db.stockMovements
        .where('productId')
        .equals(conflict.entityId)
        .toArray();
      movements.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { conflict, movements: movements.slice(0, 5) };
    }),
  );
}

export function ConflictResolverModal({ userId }: { userId?: string }) {
  const { t } = useLocale();
  const conflictViews = useLiveQuery(() => getConflictViewModels(), [], []);
  const open = conflictViews.length > 0;

  return (
    <Modal
      open={open}
      title={t('sync.conflictReviewTitle')}
      description={t('sync.conflictReviewDesc')}
      onClose={() => undefined}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{t('sync.conflictNoSilentOverwrite')}</p>
        {conflictViews.map(({ conflict: c, movements }) => {
          const meta = getRecordMeta(c);
          return (
            <div key={c.id} className="rounded-2xl border border-warning/30 bg-warning-soft/60 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {getConflictEntityLabel(c.entity, t)} {t('sync.conflictEntitySuffix')}
                    </p>
                    <Badge tone={c.severity === 'high' || c.severity === 'critical' ? 'danger' : 'warning'}>
                      {t('sync.needsReview')}
                    </Badge>
                  </div>
                  {/* "Conflicting item: Product — Coca Cola" — friendly entity
                      label + the record's own name/number where available. */}
                  <p className="mt-1 truncate text-base font-black text-slate-950" title={getRecordLabel(c)}>
                    {t('sync.conflictItemLabel')}: {getConflictEntityLabel(c.entity, t)} — {getRecordLabel(c)}
                  </p>
                  {meta.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">{meta.join(' · ')}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-600">
                    {c.conflictType.replaceAll('_', ' ')} · {c.severity}
                  </p>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-warning/20 bg-white/75 p-3 text-xs text-slate-700">
                <p className="font-semibold text-slate-900">What this means</p>
                <p className="mt-1">{getConflictMeaning(c)}</p>
              </div>

              {/* Human-readable field-by-field diff (only the changed fields),
                  instead of raw JSON, so a shop owner can actually decide. */}
              {c.changedFields && c.changedFields.length > 0 ? (
                <div className="mt-3 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500">
                        <th className="px-3 py-2 text-start font-medium">
                          {t('sync.field')}
                        </th>
                        <th className="px-3 py-2 text-start font-medium">
                          {t('sync.localValue')}
                        </th>
                        <th className="px-3 py-2 text-start font-medium">
                          {t('sync.cloudValue')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.changedFields.map((field) => (
                        <tr key={field} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-medium text-slate-700">
                            {humanizeField(field)}
                          </td>
                          <td className="px-3 py-2 text-slate-800" dir="auto">
                            {formatValue(c.localRecord?.[field])}
                          </td>
                          <td className="px-3 py-2 text-slate-800" dir="auto">
                            {formatValue(c.cloudRecord?.[field])}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-600">
                  {t('sync.conflictGeneric')}
                </p>
              )}

              {movements.length > 0 && (
                <div className="mt-3 rounded-xl bg-white ring-1 ring-slate-200">
                  <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                    Recent local stock movements
                  </div>
                  <div className="divide-y divide-slate-100 px-3">
                    {movements.map((movement) => (
                      <div key={movement.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-800">
                            {movement.movementType} · {movement.referenceType}
                          </p>
                          <p className="truncate text-slate-500" title={movement.note}>
                            {movement.note || movement.referenceId}
                          </p>
                        </div>
                        <div className="shrink-0 text-end">
                          <p className={movement.quantityChange < 0 ? 'font-bold text-danger' : 'font-bold text-success'}>
                            {movement.quantityChange > 0 ? '+' : ''}{movement.quantityChange}
                          </p>
                          <p className="text-slate-500">{formatDateTime(movement.createdAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void resolveConflictWithAction(c.id, 'keep_local', userId)}
                >
                  {t('sync.keepLocal')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void resolveConflictWithAction(c.id, 'keep_cloud', userId)}
                >
                  {t('sync.keepCloud')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void resolveConflictWithAction(c.id, 'manual', userId)}
                >
                  {t('sync.markReviewed')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

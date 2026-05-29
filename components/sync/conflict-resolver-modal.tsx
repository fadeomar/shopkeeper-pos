'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLocale } from '@/components/providers/locale-context';
import { getOpenConflicts, resolveConflictWithAction } from '@/lib/services/sync-conflict-service';

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

export function ConflictResolverModal({ userId }: { userId?: string }) {
  const { t } = useLocale();
  const conflicts = useLiveQuery(() => getOpenConflicts(), [], []);
  const open = conflicts.length > 0;
  return (
    <Modal
      open={open}
      title={t('sync.conflictReviewTitle')}
      description={t('sync.conflictReviewDesc')}
      onClose={() => undefined}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{t('sync.conflictNoSilentOverwrite')}</p>
        {conflicts.map((c) => (
          <div key={c.id} className="rounded-2xl border border-warning/30 bg-warning-soft/60 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900 capitalize">
                  {c.entity} {t('sync.conflictEntitySuffix')}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {c.conflictType.replaceAll('_', ' ')} · {c.severity}
                </p>
              </div>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-warning ring-1 ring-warning/30">
                {t('sync.needsReview')}
              </span>
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
                          {formatValue(
                            (c.localRecord as Record<string, unknown>)?.[field],
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-800" dir="auto">
                          {formatValue(
                            (c.cloudRecord as Record<string, unknown>)?.[field],
                          )}
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
            <div className="mt-4 flex flex-wrap justify-end gap-2">
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
        ))}
      </div>
    </Modal>
  );
}

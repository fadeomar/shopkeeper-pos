'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLocale } from '@/components/providers/locale-context';
import { getOpenConflicts, resolveConflictWithAction } from '@/lib/services/sync-conflict-service';

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
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <pre className="max-h-40 overflow-auto rounded-xl bg-white p-3 text-xs text-slate-700 ring-1 ring-slate-200">
                {JSON.stringify(c.cloudRecord, null, 2)}
              </pre>
              <pre className="max-h-40 overflow-auto rounded-xl bg-white p-3 text-xs text-slate-700 ring-1 ring-slate-200">
                {JSON.stringify(c.localRecord, null, 2)}
              </pre>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
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
                variant="secondary"
                size="sm"
                onClick={() => void resolveConflictWithAction(c.id, 'keep_local', userId)}
              >
                {t('sync.keepLocal')}
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

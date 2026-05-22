'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import clsx from 'clsx';
import { getLocalDataSummary } from '@/lib/services/account-data-service';
import { useLocale } from '@/components/providers/locale-context';

export function SyncStatusBadge({ compact = false }: { compact?: boolean }) {
  const { t } = useLocale();
  const summary = useLiveQuery(() => getLocalDataSummary(), [], undefined);
  if (!summary) return null;

  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  const waiting = summary.pending + summary.failed + summary.syncing + summary.blocked;
  const label = summary.blocked > 0
    ? t('sync.badgeBlocked', { count: summary.blocked })
    : summary.conflicts > 0
      ? t('sync.badgeConflicts', { count: summary.conflicts })
      : offline
        ? waiting > 0 ? t('sync.badgeOfflineSaved', { count: waiting }) : t('sync.badgeOffline')
        : summary.hasUnsyncedWork
          ? t('sync.badgeWaitingToSync', { count: waiting })
          : t('sync.badgeSyncedLocally');

  return (
    <div
      className={clsx(
        'rounded-xl px-3 py-2 text-xs font-medium ring-1',
        !compact && 'mb-3',
        compact && 'truncate px-2.5 py-1.5',
        summary.blocked > 0
          ? 'bg-red-50 text-red-700 ring-red-200'
          : summary.conflicts > 0
            ? 'bg-amber-50 text-amber-800 ring-amber-200'
            : offline
              ? 'bg-slate-800 text-slate-200 ring-slate-700'
              : summary.hasUnsyncedWork
                ? 'bg-blue-50 text-blue-700 ring-blue-200'
                : 'bg-emerald-50 text-emerald-700 ring-emerald-200',
      )}
      title={label}
    >
      {label}
    </div>
  );
}

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
          ? 'bg-danger-soft text-danger ring-danger/20'
          : summary.conflicts > 0
            ? 'bg-warning-soft text-warning ring-warning/30'
            : offline
              ? 'bg-slate-800 text-slate-200 ring-slate-700'
              : summary.hasUnsyncedWork
                ? 'bg-info-soft text-info ring-info/30'
                : 'bg-success-soft text-success ring-success/30',
      )}
      title={label}
    >
      {label}
    </div>
  );
}

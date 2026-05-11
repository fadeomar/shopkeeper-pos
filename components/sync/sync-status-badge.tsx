'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import clsx from 'clsx';
import { getLocalDataSummary } from '@/lib/services/account-data-service';

export function SyncStatusBadge({ compact = false }: { compact?: boolean }) {
  const summary = useLiveQuery(() => getLocalDataSummary(), [], undefined);
  if (!summary) return null;

  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  const waiting = summary.pending + summary.failed + summary.syncing;
  const label = summary.conflicts > 0
    ? `${summary.conflicts} conflicts need review`
    : offline
      ? waiting > 0 ? `${waiting} saved on this device` : 'Offline'
      : summary.hasUnsyncedWork
        ? `${waiting} waiting to sync`
        : 'Synced locally';

  return (
    <div
      className={clsx(
        'rounded-xl px-3 py-2 text-xs font-medium ring-1',
        !compact && 'mb-3',
        compact && 'truncate px-2.5 py-1.5',
        summary.conflicts > 0
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

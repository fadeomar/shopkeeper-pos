"use client";

import { useLiveQuery } from "dexie-react-hooks";
import clsx from "clsx";
import { getLocalDataSummary } from "@/lib/services/account-data-service";
import { alertTones } from "@/lib/design/variants";

export function SyncStatusBadge({ compact = false }: { compact?: boolean }) {
  const summary = useLiveQuery(() => getLocalDataSummary(), [], undefined);
  if (!summary) return null;

  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const waiting =
    summary.pending + summary.failed + summary.syncing + summary.blocked;
  const label =
    summary.blocked > 0
      ? `${summary.blocked} sync job${summary.blocked > 1 ? "s" : ""} blocked — open Settings`
      : summary.conflicts > 0
        ? `${summary.conflicts} conflicts need review`
        : offline
          ? waiting > 0
            ? `${waiting} saved on this device`
            : "Offline"
          : summary.hasUnsyncedWork
            ? `${waiting} waiting to sync`
            : "Synced locally";

  const toneClass =
    summary.blocked > 0
      ? alertTones.danger
      : summary.conflicts > 0
        ? alertTones.warning
        : offline
          ? alertTones.neutral
          : summary.hasUnsyncedWork
            ? alertTones.info
            : alertTones.success;

  return (
    <div
      className={clsx(
        "rounded-xl border px-3 py-2 text-xs font-medium",
        toneClass,
        !compact && "mb-3",
        compact && "truncate px-2.5 py-1.5",
      )}
      title={label}
    >
      {label}
    </div>
  );
}

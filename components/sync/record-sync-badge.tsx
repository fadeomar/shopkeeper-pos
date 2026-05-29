"use client";

import clsx from "clsx";
import { useLocale } from "@/components/providers/locale-context";
import type { SyncStatus } from "@/types/domain";

/**
 * Per-record sync status pill (Synced / Pending / Syncing / Failed / Conflict /
 * Blocked). Shared across every record-changing list so offline-first users can
 * trust that each row reached the cloud. A missing status reads as "synced"
 * (legacy rows created before the field existed).
 *
 * This is the per-row badge; the global online/offline indicator is the
 * separate `SyncStatusBadge`.
 */
const STYLES: Record<SyncStatus, string> = {
  synced: "bg-success-soft text-success border-success/20",
  pending: "bg-warning-soft text-warning border-warning/20",
  syncing: "bg-info-soft text-info border-info/20",
  failed: "bg-danger-soft text-danger border-danger/20",
  conflict: "bg-warning-soft text-warning border-warning/30",
  blocked: "bg-danger-soft text-danger border-danger/30",
};

export function RecordSyncBadge({
  status,
  className,
}: {
  status?: SyncStatus;
  className?: string;
}) {
  const { t } = useLocale();
  const effective: SyncStatus = status ?? "synced";
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
        STYLES[effective],
        className,
      )}
    >
      {t(`sync.${effective}`)}
    </span>
  );
}

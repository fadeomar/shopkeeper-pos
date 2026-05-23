import { db } from '@/lib/db/schema';
import { createId } from '@/lib/utils/id';
import { nowIso } from '@/lib/utils/date';
import { buildSyncQueueItem } from '@/lib/services/sync-queue-service';
import { getActiveUid } from '@/lib/services/account-data-service';
import type { AuditAction, AuditCategory, AuditEvent } from '@/types/domain';

/**
 * Append-only audit log. Every business-meaningful action should call
 * `logAudit(...)` so the owner has a record of who did what and when.
 *
 *   - id, createdAt, syncStatus are filled in here — callers only supply
 *     the semantic fields.
 *   - The actor UID is read from the active-user marker if not provided,
 *     so the service layer doesn't need to plumb a user through every call.
 *   - The event is queued for sync via the standard sync queue. Events
 *     are push-only (cloud copy is for history; we never re-import).
 *
 * IMPORTANT: this function never throws — audit failures must not break
 * the underlying business action. Errors are swallowed and logged.
 */
export async function logAudit(input: {
  category: AuditCategory;
  action: AuditAction;
  entityId?: string;
  entityLabel?: string;
  actorUid?: string;
  actorName?: string;
  reason?: string;
  summary?: string;
  metadata?: Record<string, string | number | boolean | null>;
  shiftId?: string;
}): Promise<void> {
  try {
    const event: AuditEvent = {
      id: createId('aud'),
      category: input.category,
      action: input.action,
      entityId: input.entityId,
      entityLabel: input.entityLabel,
      actorUid: input.actorUid ?? getActiveUid() ?? undefined,
      actorName: input.actorName,
      reason: input.reason,
      summary: input.summary,
      metadata: input.metadata,
      shiftId: input.shiftId,
      createdAt: nowIso(),
      syncStatus: 'pending',
    };

    await db.transaction('rw', [db.auditEvents, db.syncQueue], async () => {
      await db.auditEvents.add(event);
      await db.syncQueue.put(
        buildSyncQueueItem({
          entity: 'auditEvent',
          entityId: event.id,
          operation: 'create',
        }),
      );
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('shopkeeper:sync-requested'));
    }
  } catch (error) {
    // Audit logging is best-effort. Surface in dev so issues are caught
    // but never let a failed audit break the underlying action.
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[audit] failed to log event', error);
    }
  }
}

export interface AuditFilters {
  category?: AuditCategory;
  action?: AuditAction;
  entityId?: string;
  actorUid?: string;
  shiftId?: string;
  from?: string;
  to?: string;
  search?: string;
}

/**
 * List audit events, newest first, filtered by category/entity/etc.
 *
 * Hot-path note: the table is indexed on (category, action, entityId,
 * actorUid, shiftId, createdAt). For typical filter combos we narrow on
 * the most selective indexed field (entityId > shiftId > actorUid >
 * category > action) and then scan the result in memory.
 */
export async function listAuditEvents(filters: AuditFilters = {}, limit = 500): Promise<AuditEvent[]> {
  let collection;
  if (filters.entityId) {
    collection = db.auditEvents.where('entityId').equals(filters.entityId);
  } else if (filters.shiftId) {
    collection = db.auditEvents.where('shiftId').equals(filters.shiftId);
  } else if (filters.actorUid) {
    collection = db.auditEvents.where('actorUid').equals(filters.actorUid);
  } else if (filters.category) {
    collection = db.auditEvents.where('category').equals(filters.category);
  } else if (filters.action) {
    collection = db.auditEvents.where('action').equals(filters.action);
  } else {
    collection = db.auditEvents.toCollection();
  }

  let rows = await collection.toArray();

  // Apply the remaining filters in memory.
  if (filters.category) rows = rows.filter((row) => row.category === filters.category);
  if (filters.action) rows = rows.filter((row) => row.action === filters.action);
  if (filters.entityId) rows = rows.filter((row) => row.entityId === filters.entityId);
  if (filters.actorUid) rows = rows.filter((row) => row.actorUid === filters.actorUid);
  if (filters.shiftId) rows = rows.filter((row) => row.shiftId === filters.shiftId);
  if (filters.from) rows = rows.filter((row) => row.createdAt >= filters.from!);
  if (filters.to) rows = rows.filter((row) => row.createdAt <= filters.to!);
  if (filters.search) {
    const q = filters.search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) =>
        [row.entityLabel, row.actorName, row.summary, row.reason]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(q)),
      );
    }
  }

  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows.slice(0, limit);
}

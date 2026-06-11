import { settingsRepo } from "@/lib/db/repositories";
import { assertPermission } from "@/lib/services/permission-service";
import { enqueueSyncJob } from "@/lib/services/sync-queue-service";
import type { RolePermissions, Settings, UserRole } from "@/types/domain";
import { assertSubscriptionCanWrite } from '@/lib/services/subscription-service';

/**
 * Service-layer writes for the Settings row. The Settings page hides these
 * actions from unauthorized roles, but in an offline-first app the local
 * service is the real authority: IndexedDB is fully client-writable and a
 * stale cache or direct caller must not be able to persist changes a role
 * isn't allowed to make. Both functions assert permission here — BEFORE the
 * write — and enqueue the sync job so the change reaches the cloud.
 */

/** Persist general settings. Requires canManageSettings. */
export async function saveBusinessSettings(
  changes: Partial<Settings>,
): Promise<Settings> {
  await assertSubscriptionCanWrite();
  await assertPermission("canManageSettings");
  const saved = await settingsRepo.update({
    ...changes,
    syncStatus: "pending",
    lastSyncError: undefined,
  });
  await enqueueSyncJob({
    entity: "settings",
    entityId: saved.id,
    operation: "upsert",
  });
  return saved;
}

/**
 * Persist the role-permission override matrix. Requires
 * canManageRolePermissions — the meta-permission that gates the gate. Because
 * canManageRolePermissions is itself non-overridable (see
 * resolveRolePermissions), a cashier/accountant can never reach this path even
 * if they tampered with their local settings object.
 */
export async function saveRolePermissions(
  overrides: Partial<Record<UserRole, Partial<RolePermissions>>>,
): Promise<Settings> {
  await assertPermission("canManageRolePermissions");
  const saved = await settingsRepo.update({
    rolePermissions: overrides,
    syncStatus: "pending",
    lastSyncError: undefined,
  });
  await enqueueSyncJob({
    entity: "settings",
    entityId: saved.id,
    operation: "upsert",
  });
  return saved;
}

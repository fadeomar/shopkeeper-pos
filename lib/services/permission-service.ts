import { auth } from "@/lib/firebase/config";
import { db } from "@/lib/db/schema";
import { SETTINGS_ID } from "@/lib/db/repositories";
import { AppError, AppErrorCode } from "@/lib/errors/app-error";
import { DEFAULT_ROLE_PERMISSIONS } from "@/types/domain";
import type { RolePermissions, UserRole } from "@/types/domain";

/**
 * Service-layer mirror of usePermissions(). The UI hides actions a role can't
 * perform, but in an offline-first app the local service is the real authority,
 * so destructive / high-risk operations assert permission here too — defending
 * against stale cached clients, direct devtools calls, and future callers that
 * bypass the UI guard.
 *
 * Resolution mirrors the hook exactly:
 *   role  ← cached auth entry (offline-safe: firebase auth.currentUser + Dexie
 *           authCache), defaulting to the most restrictive 'cashier' when
 *           unknown (same default the hook uses) so we fail closed, not open.
 *   perms ← DEFAULT_ROLE_PERMISSIONS[role] then settings.rolePermissions[role].
 *
 * IMPORTANT: call these BEFORE opening a Dexie rw transaction — they read the
 * authCache/settings tables, which would be outside an unrelated transaction's
 * scope.
 */
export async function getCurrentPermissions(): Promise<RolePermissions> {
  let role: UserRole = "cashier";
  try {
    const uid = auth.currentUser?.uid;
    if (uid) {
      const entry = await db.authCache.get(uid);
      if (entry?.role) role = entry.role as UserRole;
    }
  } catch {
    /* fall back to cashier */
  }

  const base =
    DEFAULT_ROLE_PERMISSIONS[role] ?? DEFAULT_ROLE_PERMISSIONS.cashier;

  let overrides: Partial<RolePermissions> = {};
  try {
    const settings = await db.settings.get(SETTINGS_ID);
    overrides = settings?.rolePermissions?.[role] ?? {};
  } catch {
    /* no overrides available */
  }

  return { ...base, ...overrides };
}

/** Throw PERMISSION_DENIED unless the current user holds the given permission. */
export async function assertPermission(
  key: keyof RolePermissions,
): Promise<void> {
  const perms = await getCurrentPermissions();
  if (!perms[key]) {
    throw new AppError(AppErrorCode.PERMISSION_DENIED);
  }
}

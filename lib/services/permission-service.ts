import { auth } from "@/lib/firebase/config";
import { db } from "@/lib/db/schema";
import { SETTINGS_ID } from "@/lib/db/repositories";
import { AppError, AppErrorCode } from "@/lib/errors/app-error";
import { isUserRole, resolveRolePermissions, NO_PERMISSIONS } from "@/types/domain";
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
 *           authCache). When the role can't be determined we return
 *           NO_PERMISSIONS (deny all) so we fail closed, not open — we can no
 *           longer default to a real role because 'cashier' is now the top
 *           shop-side role and would fail OPEN.
 *   perms ← DEFAULT_ROLE_PERMISSIONS[role] then settings.rolePermissions[role].
 *
 * IMPORTANT: call these BEFORE opening a Dexie rw transaction — they read the
 * authCache/settings tables, which would be outside an unrelated transaction's
 * scope.
 */
export async function getCurrentPermissions(): Promise<RolePermissions> {
  let role: UserRole | null = null;
  try {
    const uid = auth.currentUser?.uid;
    if (uid) {
      const entry = await db.authCache.get(uid);
      if (isUserRole(entry?.role)) role = entry.role;
    }
  } catch {
    /* role stays null → deny all below */
  }

  // Role unknown → fail closed. Never assume a role here.
  if (!role) return NO_PERMISSIONS;

  let overrides: Partial<RolePermissions> = {};
  try {
    const settings = await db.settings.get(SETTINGS_ID);
    overrides = settings?.rolePermissions?.[role] ?? {};
  } catch {
    /* no overrides available */
  }

  // Non-overridable meta-permissions are stripped back to the role defaults
  // inside resolveRolePermissions, so a tampered local override can't escalate.
  return resolveRolePermissions(role, overrides);
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

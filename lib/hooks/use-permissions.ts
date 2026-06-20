import { useAuth } from '@/components/providers/auth-context';
import { useSettings } from '@/components/providers/settings-context';
import type { RolePermissions } from '@/types/domain';
import { isUserRole, resolveRolePermissions, NO_PERMISSIONS } from '@/types/domain';

/**
 * Returns the effective permissions for the currently signed-in user.
 * Base permissions come from DEFAULT_ROLE_PERMISSIONS[role]; per-role
 * overrides stored in settings.rolePermissions are applied on top — except the
 * non-overridable meta-permissions (see resolveRolePermissions), which always
 * follow the role defaults so a tampered local settings object can't escalate.
 */
export function usePermissions(): RolePermissions {
  const { user } = useAuth();
  const { settings } = useSettings();

  // Fail closed when the signed-in user has no resolvable role.
  const role = user?.role;
  if (!isUserRole(role)) return NO_PERMISSIONS;

  const overrides = role === 'administration' ? undefined : settings?.rolePermissions?.[role];

  return resolveRolePermissions(role, overrides);
}

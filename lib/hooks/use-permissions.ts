import { useAuth } from '@/components/providers/auth-context';
import { useSettings } from '@/components/providers/settings-context';
import type { UserRole, RolePermissions } from '@/types/domain';
import { DEFAULT_ROLE_PERMISSIONS } from '@/types/domain';

/**
 * Returns the effective permissions for the currently signed-in user.
 * Base permissions come from DEFAULT_ROLE_PERMISSIONS[role]; per-role
 * overrides stored in settings.rolePermissions are applied on top.
 */
export function usePermissions(): RolePermissions {
  const { user } = useAuth();
  const { settings } = useSettings();

  const role = ((user?.role ?? 'cashier') as UserRole);
  const basePerms = DEFAULT_ROLE_PERMISSIONS[role] ?? DEFAULT_ROLE_PERMISSIONS.cashier;
  const overrides = settings?.rolePermissions?.[role] ?? {};

  return { ...basePerms, ...overrides };
}

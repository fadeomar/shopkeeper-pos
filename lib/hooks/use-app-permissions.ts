import { useMemo } from 'react';
import { usePermissions } from '@/lib/hooks/use-permissions';
import { useAuth } from '@/components/providers/auth-context';
import { canAccessRoute, canAppPermission, type AppPermission } from '@/lib/permissions/permission-engine';

export function useAppPermissions() {
  const legacy = usePermissions();
  const { user } = useAuth();
  const role = user?.role;

  return useMemo(() => ({
    ...legacy,
    role,
    can: (permission: AppPermission) => canAppPermission(role, legacy, permission),
    canAccessRoute: (pathname: string) => canAccessRoute(role, legacy, pathname),
  }), [legacy, role]);
}

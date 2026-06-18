import { NO_PERMISSIONS, isUserRole, resolveRolePermissions, type RolePermissions, type UserRole } from '@/types/domain';

export type AppPermission =
  | 'sales.view' | 'sales.create' | 'sales.discount' | 'sales.void' | 'sales.return'
  | 'products.view' | 'products.create' | 'products.edit' | 'products.editCost' | 'products.importExport'
  | 'inventory.view' | 'inventory.adjust'
  | 'purchases.view' | 'purchases.create'
  | 'customers.view' | 'customers.manage'
  | 'suppliers.view' | 'suppliers.manage'
  | 'reports.view' | 'reports.export'
  | 'cash.manage' | 'expenses.manage' | 'shifts.manage'
  | 'settings.manage' | 'roles.manage' | 'audit.view' | 'users.manage'
  | 'system.stores.manage' | 'system.users.view' | 'system.diagnostics.view';

export type RoutePermission = AppPermission | AppPermission[] | null;

const isSystemAdmin = (role: UserRole) => role === 'administration';
const isStoreOwner = (role: UserRole) => role === 'owner' || isSystemAdmin(role);
const isStoreManager = (role: UserRole) => role === 'manager' || isStoreOwner(role);
const isOperational = (role: UserRole) => role === 'cashier' || isStoreManager(role);
const canReadOperational = (role: UserRole) => role === 'cashier' || role === 'manager' || role === 'accountant' || isStoreOwner(role);

function fromRole(role: UserRole, perms: RolePermissions, permission: AppPermission): boolean {
  if (permission.startsWith('system.')) return isSystemAdmin(role);

  switch (permission) {
    case 'sales.view': return canReadOperational(role);
    case 'sales.create': return isOperational(role);
    case 'sales.discount': return isStoreOwner(role) || perms.canDiscount;
    case 'sales.void': return isStoreOwner(role) || perms.canVoid;
    case 'sales.return': return isStoreOwner(role) || perms.canReturn;

    case 'products.view':
    case 'inventory.view':
    case 'purchases.view':
    case 'customers.view':
    case 'suppliers.view':
      return canReadOperational(role);
    case 'reports.view':
      return role === 'manager' || role === 'accountant' || isStoreOwner(role);

    case 'products.create':
    case 'products.edit':
    case 'inventory.adjust':
    case 'purchases.create':
    case 'customers.manage':
    case 'suppliers.manage':
    case 'cash.manage':
    case 'expenses.manage':
      return isStoreManager(role);

    case 'shifts.manage': return isOperational(role);
    case 'products.editCost': return isStoreOwner(role) || perms.canEditCost;
    case 'products.importExport':
    case 'reports.export': return isStoreOwner(role) || perms.canExport;
    case 'settings.manage': return isStoreOwner(role) && perms.canManageSettings;
    case 'roles.manage': return isStoreOwner(role) && perms.canManageRolePermissions;
    case 'audit.view': return role === 'manager' || role === 'accountant' || isStoreOwner(role);
    case 'users.manage': return isStoreOwner(role);
    default: return false;
  }
}

export function canAppPermission(role: unknown, permissions: RolePermissions = NO_PERMISSIONS, permission: AppPermission): boolean {
  if (!isUserRole(role)) return false;
  return fromRole(role, permissions, permission);
}

export function resolveAppPermissions(role: unknown, overrides?: Partial<RolePermissions>) {
  if (!isUserRole(role)) return { role: null, legacy: NO_PERMISSIONS, can: () => false };
  const legacy = resolveRolePermissions(role, overrides);
  return { role, legacy, can: (permission: AppPermission) => canAppPermission(role, legacy, permission) };
}

export const ROUTE_PERMISSIONS: Record<string, RoutePermission> = {
  '/': 'sales.view',
  '/billing': 'sales.create',
  '/bills': 'sales.view',
  '/products': 'products.view',
  '/inventory': 'inventory.view',
  '/purchases/new': 'purchases.create',
  '/purchases': 'purchases.view',
  '/customers': 'customers.view',
  '/suppliers': 'suppliers.view',
  '/reports': 'reports.view',
  '/shift': 'shifts.manage',
  '/cash': 'cash.manage',
  '/expenses': 'expenses.manage',
  '/settings': ['settings.manage', 'roles.manage'],
  '/audit': 'audit.view',
};

export function canAccessRequirement(role: unknown, permissions: RolePermissions, requirement: RoutePermission): boolean {
  if (!requirement) return true;
  if (Array.isArray(requirement)) return requirement.some((permission) => canAppPermission(role, permissions, permission));
  return canAppPermission(role, permissions, requirement);
}

export function getRoutePermission(pathname: string): RoutePermission {
  const normalized = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
  if (normalized.startsWith('/purchases/new')) return ROUTE_PERMISSIONS['/purchases/new'];
  const match = Object.keys(ROUTE_PERMISSIONS)
    .filter((route) => route !== '/' && (normalized === route || normalized.startsWith(`${route}/`)))
    .sort((a, b) => b.length - a.length)[0];
  return match ? ROUTE_PERMISSIONS[match] : null;
}

export function canAccessRoute(role: unknown, permissions: RolePermissions, pathname: string): boolean {
  return canAccessRequirement(role, permissions, getRoutePermission(pathname));
}

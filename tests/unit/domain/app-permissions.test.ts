import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, NO_PERMISSIONS } from '@/types/domain';
import { canAccessRoute, canAppPermission, resolveAppPermissions } from '@/lib/permissions/permission-engine';

describe('app permission engine', () => {
  it('gives store owner full store access without granting cross-store/system ownership', () => {
    const permissions = DEFAULT_ROLE_PERMISSIONS.owner;
    expect(canAppPermission('owner', permissions, 'sales.create')).toBe(true);
    expect(canAppPermission('owner', permissions, 'products.edit')).toBe(true);
    expect(canAppPermission('owner', permissions, 'users.manage')).toBe(true);
    expect(canAppPermission('owner', permissions, 'settings.manage')).toBe(true);
    expect(canAppPermission('owner', permissions, 'system.stores.manage')).toBe(false);
    expect(canAccessRoute('owner', permissions, '/settings')).toBe(true);
  });

  it('keeps system administration above stores but separate from customer owner role', () => {
    const permissions = DEFAULT_ROLE_PERMISSIONS.administration;
    expect(canAppPermission('administration', permissions, 'system.stores.manage')).toBe(true);
    expect(canAppPermission('administration', permissions, 'system.users.view')).toBe(true);
    expect(canAppPermission('administration', permissions, 'users.manage')).toBe(true);
  });

  it('allows manager daily operations but blocks user/settings management', () => {
    const permissions = DEFAULT_ROLE_PERMISSIONS.manager;
    expect(canAccessRoute('manager', permissions, '/billing')).toBe(true);
    expect(canAccessRoute('manager', permissions, '/products')).toBe(true);
    expect(canAccessRoute('manager', permissions, '/purchases/new')).toBe(true);
    expect(canAppPermission('manager', permissions, 'users.manage')).toBe(false);
    expect(canAppPermission('manager', permissions, 'settings.manage')).toBe(false);
  });

  it('keeps cashier narrow for sales/returns/shifts and blocks catalog/admin surfaces', () => {
    const permissions = DEFAULT_ROLE_PERMISSIONS.cashier;
    expect(canAccessRoute('cashier', permissions, '/billing')).toBe(true);
    expect(canAppPermission('cashier', permissions, 'sales.create')).toBe(true);
    expect(canAppPermission('cashier', permissions, 'sales.return')).toBe(true);
    expect(canAppPermission('cashier', permissions, 'shifts.manage')).toBe(true);
    expect(canAppPermission('cashier', permissions, 'products.edit')).toBe(false);
    expect(canAppPermission('cashier', permissions, 'reports.view')).toBe(false);
    expect(canAccessRoute('cashier', permissions, '/settings')).toBe(false);
  });

  it('allows accountant read/report flows but blocks operational writes', () => {
    const permissions = DEFAULT_ROLE_PERMISSIONS.accountant;
    expect(canAccessRoute('accountant', permissions, '/reports')).toBe(true);
    expect(canAccessRoute('accountant', permissions, '/products')).toBe(true);
    expect(canAccessRoute('accountant', permissions, '/billing')).toBe(false);
    expect(canAccessRoute('accountant', permissions, '/purchases/new')).toBe(false);
    expect(canAppPermission('accountant', permissions, 'products.edit')).toBe(false);
  });

  it('fails closed for unknown role or missing cached permissions', () => {
    expect(resolveAppPermissions(undefined).can('sales.create')).toBe(false);
    expect(canAccessRoute(undefined, NO_PERMISSIONS, '/billing')).toBe(false);
    expect(canAppPermission('unknown', NO_PERMISSIONS, 'settings.manage')).toBe(false);
  });

  it('uses existing role overrides for action-level permissions without meta escalation', () => {
    const overridden = { ...DEFAULT_ROLE_PERMISSIONS.manager, canDiscount: false };
    expect(canAppPermission('manager', overridden, 'sales.create')).toBe(true);
    expect(canAppPermission('manager', overridden, 'sales.discount')).toBe(false);
  });
});

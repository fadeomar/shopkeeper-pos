import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_PERMISSIONS,
  NO_PERMISSIONS,
  resolveRolePermissions,
} from '@/types/domain';

describe('role permission resolution', () => {
  it('fails closed for unknown roles', () => {
    expect(resolveRolePermissions('unknown')).toEqual(NO_PERMISSIONS);
    expect(resolveRolePermissions(null)).toEqual(NO_PERMISSIONS);
  });

  it('keeps owner closed for POS operations', () => {
    expect(resolveRolePermissions('owner')).toEqual(DEFAULT_ROLE_PERMISSIONS.owner);
    expect(resolveRolePermissions('owner').canVoid).toBe(false);
    expect(resolveRolePermissions('owner').canManageSettings).toBe(false);
  });

  it('keeps cashier as the fixed top operational role and ignores overrides', () => {
    const resolved = resolveRolePermissions('cashier', {
      canVoid: false,
      canManageSettings: false,
      canManageRolePermissions: false,
    });

    expect(resolved).toEqual(DEFAULT_ROLE_PERMISSIONS.cashier);
  });

  it('allows future/lower role overrides but blocks meta-permission escalation', () => {
    const resolved = resolveRolePermissions('accountant', {
      canVoid: true,
      canManageSettings: true,
      canManageRolePermissions: true,
    });

    expect(resolved.canVoid).toBe(true);
    expect(resolved.canManageSettings).toBe(false);
    expect(resolved.canManageRolePermissions).toBe(false);
  });

  it('preserves manager operational defaults below cashier', () => {
    expect(resolveRolePermissions('manager').canEditCost).toBe(false);
    expect(resolveRolePermissions('manager').canDiscount).toBe(true);
  });
});

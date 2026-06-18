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

  it('keeps administration as the system-level full access role', () => {
    expect(resolveRolePermissions('administration')).toEqual(DEFAULT_ROLE_PERMISSIONS.administration);
    expect(resolveRolePermissions('administration').canManageSettings).toBe(true);
    expect(resolveRolePermissions('administration').canManageRolePermissions).toBe(true);
  });

  it('keeps owner as the fixed full store role', () => {
    expect(resolveRolePermissions('owner')).toEqual(DEFAULT_ROLE_PERMISSIONS.owner);
    expect(resolveRolePermissions('owner').canVoid).toBe(true);
    expect(resolveRolePermissions('owner').canManageSettings).toBe(true);
  });

  it('keeps cashier narrow but allows safe non-meta overrides from settings', () => {
    const resolved = resolveRolePermissions('cashier', {
      canDiscount: true,
      canManageSettings: true,
      canManageRolePermissions: true,
    });

    expect(resolved.canDiscount).toBe(true);
    expect(resolved.canManageSettings).toBe(false);
    expect(resolved.canManageRolePermissions).toBe(false);
  });

  it('allows lower role overrides but blocks meta-permission escalation', () => {
    const resolved = resolveRolePermissions('accountant', {
      canVoid: true,
      canManageSettings: true,
      canManageRolePermissions: true,
    });

    expect(resolved.canVoid).toBe(true);
    expect(resolved.canManageSettings).toBe(false);
    expect(resolved.canManageRolePermissions).toBe(false);
  });

  it('preserves manager operational defaults below owner', () => {
    expect(resolveRolePermissions('manager').canEditCost).toBe(false);
    expect(resolveRolePermissions('manager').canDiscount).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDemoDataUiEnabled, isRolePermissionsUiEnabled } from '@/lib/config/feature-flags';

describe('production feature flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hides role permissions by default unless explicitly enabled', () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_ROLE_PERMISSIONS', undefined);
    expect(isRolePermissionsUiEnabled()).toBe(false);

    vi.stubEnv('NEXT_PUBLIC_ENABLE_ROLE_PERMISSIONS', '1');
    expect(isRolePermissionsUiEnabled()).toBe(true);
  });

  it('allows demo data only when explicitly enabled or in local development', () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_DEMO_DATA', '0');
    expect(isDemoDataUiEnabled()).toBe(false);

    vi.stubEnv('NEXT_PUBLIC_ENABLE_DEMO_DATA', '1');
    expect(isDemoDataUiEnabled()).toBe(true);
  });
});

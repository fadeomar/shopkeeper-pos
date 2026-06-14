function readPublicFlag(name: string): string | undefined {
  return process.env[name];
}

function isTruthyFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function isFalsyFlag(value: string | undefined): boolean {
  return value === '0' || value === 'false' || value === 'no' || value === 'off';
}

/**
 * Demo data must never be a daily-production dashboard action. It is only
 * available for local development by default, or explicitly enabled on an
 * internal staging deployment via NEXT_PUBLIC_ENABLE_DEMO_DATA=1.
 */
export function isDemoDataUiEnabled(): boolean {
  const configured = readPublicFlag('NEXT_PUBLIC_ENABLE_DEMO_DATA');
  if (isTruthyFlag(configured)) return true;
  if (isFalsyFlag(configured)) return false;
  return process.env.NODE_ENV === 'development';
}

/**
 * Role-permission editing is intentionally hidden from production until the
 * multi-user/store-membership model is complete. Keep the existing code behind
 * an explicit flag so we can continue testing it internally without confusing
 * real users.
 */
export function isRolePermissionsUiEnabled(): boolean {
  return isTruthyFlag(readPublicFlag('NEXT_PUBLIC_ENABLE_ROLE_PERMISSIONS'));
}

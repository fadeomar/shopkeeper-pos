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
 *
 * NOTE: `process.env.NEXT_PUBLIC_*` must be referenced by its static, literal
 * name — Next.js/Turbopack only inlines public env vars into the client bundle
 * when they are accessed that way. Reading them through a computed key
 * (`process.env[name]`) leaves the value `undefined` in the browser, which
 * silently disabled this flag on the client.
 */
export function isDemoDataUiEnabled(): boolean {
  const configured = process.env.NEXT_PUBLIC_ENABLE_DEMO_DATA;
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
  return isTruthyFlag(process.env.NEXT_PUBLIC_ENABLE_ROLE_PERMISSIONS);
}

/**
 * Customer identity helpers used by the customer-ledger service, the v7
 * Dexie migration that backfills the customers table, and the POS typeahead.
 *
 * Two normalizations coexist:
 *
 * - normalizeCustomerKey() returns a stable string of the form `phone:<X>`
 *   or `name:<X>` for use as a Map key when grouping bills that predate
 *   the customers table. This is the legacy key that the customer ledger
 *   used before B-β.
 *
 * - normalizePhone() returns a digit-only canonical phone for the
 *   `customers.normalizedPhone` index, so lookups tolerate spaces, dashes,
 *   and leading-zero / country-code variations within reason.
 */

export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/[^\d]/g, '');
}

export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeCustomerKey(input: { name?: string; phone?: string }): string {
  const phone = normalizePhone(input.phone);
  if (phone) return `phone:${phone}`;
  const name = normalizeName(input.name);
  return name ? `name:${name}` : '';
}

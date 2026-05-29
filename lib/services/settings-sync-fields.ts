import type { Settings } from "@/types/domain";

/**
 * Single source of truth for how the settings document syncs across devices.
 *
 * Settings is no longer cosmetic — it drives POS business rules (payment
 * methods, tax mode, discount limit, shift requirement, etc.) — so every
 * editable field must participate in conflict detection / cloud pull, and the
 * two monotonic counters must merge safely. Keeping these lists here prevents
 * the bug where one sync file knew about a field and another didn't.
 */

/**
 * Monotonic counters in the settings doc. They only ever move forward, so
 * across devices they merge with `Math.max` and must NEVER raise a conflict —
 * offline bill/purchase creation legitimately advances them past the cloud.
 */
export const SETTINGS_SEQUENCE_FIELDS = [
  "nextBillSequence",
  "nextPurchaseSequence",
] as const;

/**
 * Business settings tracked for change detection + cloud pull: anything the
 * store owner can edit and expect to survive a sync from another device.
 */
export const SETTINGS_BUSINESS_FIELDS: Array<keyof Settings> = [
  "storeName",
  "cashierName",
  "currency",
  "allowLossSale",
  "lowStockHighlight",
  "businessAddress",
  "businessPhone",
  "taxMode",
  "defaultDiscountLimit",
  "requireShift",
  "receiptHeader",
  "receiptFooter",
  "enableCash",
  "enableCard",
  "enableCredit",
  "lowStockThreshold",
  "expiryWarningDays",
  "rolePermissions",
];

/** All settings fields compared for change detection (business + sequence). */
export const SETTINGS_TRACKED_FIELDS: string[] = [
  ...(SETTINGS_BUSINESS_FIELDS as string[]),
  ...SETTINGS_SEQUENCE_FIELDS,
];

/** True for the monotonic counter fields that should never conflict. */
export function isSettingsSequenceField(field: string): boolean {
  return (SETTINGS_SEQUENCE_FIELDS as readonly string[]).includes(field);
}

/** Coerce a sequence value to a positive integer, falling back when invalid. */
export function finiteSequence(value: unknown, fallback = 1): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

/** Max-merge both monotonic counters from a local + cloud settings pair. */
export function mergedSequences(
  local: Partial<Settings>,
  cloud: Partial<Settings>,
): { nextBillSequence: number; nextPurchaseSequence: number } {
  return {
    nextBillSequence: Math.max(
      finiteSequence(local.nextBillSequence),
      finiteSequence(cloud.nextBillSequence),
    ),
    nextPurchaseSequence: Math.max(
      finiteSequence(local.nextPurchaseSequence),
      finiteSequence(cloud.nextPurchaseSequence),
    ),
  };
}

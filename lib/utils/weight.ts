/**
 * Weight handling for weight-based (`saleType === 'weight'`) products.
 *
 * Two units are in play and must not be confused:
 *
 *  - The BASE unit is the GRAM. Every stored weight quantity — product stock,
 *    inventory lots, stock movements, bill/purchase base quantities — is an
 *    integer number of grams, so weight arithmetic never accumulates
 *    floating-point error (the integer-safe rule from the spec).
 *
 *  - The PRICING unit is the KILOGRAM. Weighted prices are entered and stored
 *    as price-per-kg, and money math multiplies a per-kg price by a kg
 *    quantity (which CAN be fractional, e.g. 0.75 kg). We never multiply by a
 *    sub-cent per-gram price — the cents-based money helpers in `money.ts`
 *    cannot represent 0.003 ₪, so that path would round to zero.
 *
 * Unit products are unaffected: their base unit is the piece, the factor is 1,
 * and all existing piece/price math is bit-for-bit unchanged.
 *
 * Display note: per the product spec, the unit suffix stays Latin ("kg"/"g")
 * in both English and Arabic, so these formatters are locale-independent and
 * render correctly under RTL without bidi reordering of the number.
 */
import { multiplyMoney } from '@/lib/utils/money';
import type { LotBaseUnit, ProductSaleType } from '@/types/domain';

export const GRAMS_PER_KG = 1000;

/** Base units per pricing unit: gram lots price per kg (1000), piece lots per piece (1). */
export function baseUnitsPerPricingUnit(baseUnit: LotBaseUnit | undefined): number {
  return baseUnit === 'gram' ? GRAMS_PER_KG : 1;
}

/** The integer base unit a product/line is tracked in: grams for weight, pieces otherwise. */
export function lotBaseUnitFor(saleType: ProductSaleType | undefined): LotBaseUnit {
  return saleType === 'weight' ? 'gram' : 'piece';
}

/**
 * The pricing-unit quantity for money math, given an integer base quantity.
 * Weight → kilograms (grams ÷ 1000, may be fractional); unit → the base count
 * unchanged. This is the multiplier paired with a per-kg / per-piece price.
 */
export function pricingQuantityFor(
  saleType: ProductSaleType | undefined,
  baseQuantity: number,
): number {
  return saleType === 'weight' ? gramsToKg(baseQuantity) : baseQuantity;
}

/** Convert a kilogram amount to integer grams (rounds to the nearest gram). */
export function kgToGrams(kg: number): number {
  if (!Number.isFinite(kg)) return 0;
  return Math.round(kg * GRAMS_PER_KG);
}

/** Convert grams to kilograms (may be fractional — used as a money multiplier). */
export function gramsToKg(grams: number): number {
  if (!Number.isFinite(grams)) return 0;
  return grams / GRAMS_PER_KG;
}

/**
 * Parse a user-typed weight into integer grams. Defaults to interpreting the
 * input as kilograms. Returns `null` for blank, non-numeric, or negative
 * input so callers can surface a validation message rather than silently
 * coercing to 0.
 */
export function parseWeightInput(value: string, unit: 'kg' | 'g' = 'kg'): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return unit === 'kg' ? kgToGrams(parsed) : Math.round(parsed);
}

/** Trim trailing-zero decimals from a kg number: 1 → "1", 1.5 → "1.5", 0.75 → "0.75". */
function formatKgNumber(kg: number): string {
  // Up to 3 decimals (1 g resolution), then drop trailing zeros and any
  // dangling decimal point.
  return kg
    .toFixed(3)
    .replace(/\.?0+$/, '');
}

/**
 * Compact weight for listings/badges: under 1 kg shows whole grams
 * ("250 g"), 1 kg and over shows kilograms ("1 kg", "1.5 kg", "62.5 kg").
 */
export function formatWeight(grams: number): string {
  const safe = Number.isFinite(grams) ? Math.max(0, Math.round(grams)) : 0;
  if (safe < GRAMS_PER_KG) return `${safe} g`;
  return `${formatKgNumber(gramsToKg(safe))} kg`;
}

/**
 * Cart/receipt weight — always expressed in kilograms so a line reads
 * "0.75 kg × 5 ₪/kg" regardless of size.
 */
export function formatWeightForCart(grams: number): string {
  const safe = Number.isFinite(grams) ? Math.max(0, Math.round(grams)) : 0;
  return `${formatKgNumber(gramsToKg(safe))} kg`;
}

/**
 * Display a product's base quantity (stock, threshold) with its unit: a
 * compact weight ("62.5 kg", "250 g") for weight products, the plain count
 * for unit products.
 */
export function formatStockDisplay(
  saleType: ProductSaleType | undefined,
  baseQuantity: number,
): string {
  return saleType === 'weight' ? formatWeight(baseQuantity) : String(baseQuantity);
}

/**
 * Format a sold/returned line quantity for receipts, bill detail, and reports:
 * a kilogram weight ("0.75 kg") when the line is weight-based, otherwise the
 * plain count. `baseQuantity` is the integer grams; `count` is the pricing
 * quantity used for unit lines.
 */
export function formatWeightOrCount(
  saleType: ProductSaleType | undefined,
  baseQuantity: number | undefined,
  count: number,
): string {
  return saleType === 'weight' ? formatWeightForCart(baseQuantity ?? 0) : String(count);
}

/**
 * Money for a weighted line: price-per-kg × kilograms sold. Integer-safe by
 * routing through `multiplyMoney` (cents × fractional-kg, then rounded).
 *   250 g  @ 8 ₪/kg → 2.00
 *   750 g  @ 5 ₪/kg → 3.75
 *   1.5 kg @ 5 ₪/kg → 7.50
 */
export function calculateWeightedLineTotal(pricePerKg: number, grams: number): number {
  return multiplyMoney(pricePerKg, gramsToKg(grams));
}

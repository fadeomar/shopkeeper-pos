/**
 * Display helpers for purchase line items.
 *
 * A purchase line ALWAYS stores `quantityPurchased` in BASE units (so stock,
 * lots, return, and void all work uniformly) — see purchase-service.ts. What
 * varies by sale type is how to present that:
 *   - multi_unit: `quantityPurchased`/`baseQuantityPurchased` are the BASE
 *     (piece) count (e.g. 1500 pills); the bought-unit count is recovered as
 *     base ÷ `conversionToBaseAtPurchase` (1500 ÷ 150 = 10 box).
 *     `unitCostAtPurchase` is the cost per BOUGHT unit (18 / box).
 *   - weight: `quantityPurchased` is GRAMS and `unitCostAtPurchase` is per KG.
 *   - unit/misc: `quantityPurchased` is a plain count.
 *
 * These helpers turn each field into a labelled, unambiguous string so the UI
 * never shows a bare "1500 / 18 / 180" that looks arithmetically wrong. Kept
 * pure (no i18n/currency coupling — callers pass the suffix strings) so they
 * are unit-tested directly.
 */
import type { PurchaseItem } from '@/types/domain';
import { formatWeight } from '@/lib/utils/weight';
import { isMiscLine } from '@/lib/utils/misc-items';

/**
 * Format an arbitrary BASE-unit quantity in the line's bought unit: "10 box"
 * (multi — base ÷ conversion), "2.5 kg" (weight — grams), "5" (unit). Callers
 * pass a base count (purchased, returned, or remaining); `formatPurchaseQuantity`
 * is this applied to the line's purchased quantity.
 */
export function formatPurchaseBaseQuantity(item: PurchaseItem, baseQuantity: number): string {
  if (item.saleType === 'multi_unit') {
    const unitName = item.purchaseUnitNameAtPurchase?.trim();
    const conversion = item.conversionToBaseAtPurchase || 1;
    const boughtQty = baseQuantity / conversion;
    return unitName ? `${boughtQty} ${unitName}` : String(boughtQty);
  }
  if (item.saleType === 'weight') return formatWeight(baseQuantity);
  return String(baseQuantity);
}

/** Quantity in the bought unit: "10 box" (multi), "2.5 kg" (weight), "5" (unit). */
export function formatPurchaseQuantity(item: PurchaseItem): string {
  // multi_unit snapshots its base count in baseQuantityPurchased (falls back to
  // quantityPurchased, which is also base); weight/unit use quantityPurchased.
  const base =
    item.saleType === 'multi_unit'
      ? item.baseQuantityPurchased ?? item.quantityPurchased
      : item.quantityPurchased;
  return formatPurchaseBaseQuantity(item, base);
}

/**
 * Base-unit stock added: "+1500 pill" (multi), "+2.5 kg" (weight), "+5" (unit),
 * "—" (misc — carries no stock). For multi_unit this is the BASE count, not the
 * bought-unit count, which is the field the old UI got wrong.
 */
export function formatPurchaseStockImpact(item: PurchaseItem, baseUnitName: string): string {
  if (isMiscLine(item)) return '—';
  if (item.saleType === 'multi_unit') {
    // quantityPurchased is ALREADY the base count — never multiply by conversion.
    const base = item.baseQuantityPurchased ?? item.quantityPurchased;
    const name = baseUnitName.trim();
    return name ? `+${base} ${name}` : `+${base}`;
  }
  if (item.saleType === 'weight') return `+${formatWeight(item.quantityPurchased)}`;
  return `+${item.quantityPurchased}`;
}

/**
 * Suffix appended after the formatted unit cost: " / box" (multi), the per-kg
 * suffix (weight), "" (unit). `perKgSuffix` is the localized "/ kg" string.
 */
export function purchaseUnitCostSuffix(item: PurchaseItem, perKgSuffix: string): string {
  if (item.saleType === 'multi_unit') {
    const unitName = item.purchaseUnitNameAtPurchase?.trim();
    return unitName ? ` / ${unitName}` : '';
  }
  if (item.saleType === 'weight') return ` ${perKgSuffix}`;
  return '';
}

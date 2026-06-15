/**
 * Multi-unit products (`saleType === 'multi_unit'`): one product sold/bought in
 * related units (pharmacy pill/strip/box, supermarket carton/pack/piece).
 *
 * The BASE unit is the smallest sale unit (a pill) and is tracked as a 'piece'
 * lot — so `Product.quantityInStock`, `minimumStockAlert`, inventory lots, and
 * stock movements are all integer BASE-unit counts, exactly like a plain unit
 * product (conversion factor 1, integer-safe by construction).
 *
 * Each sellable/purchasable unit is a `ProductUnit` row with its own
 * `conversionToBase` (a positive integer — the base unit equals 1) and its own
 * prices. Legacy 'unit'/'weight' products have NO ProductUnit rows; the helpers
 * here synthesize a single virtual `legacy-unit` so the rest of the app can
 * treat every product uniformly without a giant rewrite.
 */
import type { Product, ProductUnit, ProductSaleType } from '@/types/domain';
import { formatStockDisplay } from '@/lib/utils/weight';

/** The synthetic id given to the virtual unit of a non-multi_unit product. */
export const LEGACY_UNIT_ID = 'legacy-unit';

/** Resolve a product's effective sale type (absent === 'unit'). */
export function getProductSaleType(product: Pick<Product, 'saleType'>): ProductSaleType {
  return product.saleType ?? 'unit';
}

export function isMultiUnitProduct(product: Pick<Product, 'saleType'>): boolean {
  return getProductSaleType(product) === 'multi_unit';
}

/**
 * The display name of a product's base unit. For multi_unit products this is
 * the `Product.unit` field (the smallest unit's name, e.g. "pill" / "حبة"); for
 * unit/weight products it's the product's unit string as well.
 */
export function getBaseUnitName(product: Pick<Product, 'unit'>): string {
  return product.unit?.trim() || 'unit';
}

/**
 * Synthesize the single virtual unit that represents a non-multi_unit product
 * (or a multi_unit product whose units failed to load). conversionToBase is 1
 * so all downstream base-unit math is a no-op.
 */
export function buildLegacyUnit(product: Product): ProductUnit {
  return {
    id: LEGACY_UNIT_ID,
    productId: product.id,
    name: getBaseUnitName(product),
    conversionToBase: 1,
    sellPrice: product.sellPrice,
    buyPrice: product.buyPrice,
    barcode: product.barcode,
    canSell: true,
    canPurchase: true,
    isDefaultSaleUnit: true,
    sortOrder: 0,
    createdAt: product.dateAdded,
    updatedAt: product.lastUpdated,
  };
}

/** All of a product's units sorted by conversion ascending (base unit first). */
function sortedUnits(units: ProductUnit[]): ProductUnit[] {
  return [...units].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.conversionToBase - b.conversionToBase,
  );
}

/**
 * Every usable unit for a product. multi_unit → its ProductUnit rows (or the
 * legacy fallback if none loaded); unit/weight → a single virtual unit.
 */
export function getAllUnits(product: Product, units: ProductUnit[] | undefined): ProductUnit[] {
  if (!isMultiUnitProduct(product)) return [buildLegacyUnit(product)];
  const own = (units ?? []).filter((u) => u.productId === product.id);
  return own.length > 0 ? sortedUnits(own) : [buildLegacyUnit(product)];
}

export function getSellableUnits(product: Product, units: ProductUnit[] | undefined): ProductUnit[] {
  const all = getAllUnits(product, units);
  const sellable = all.filter((u) => u.canSell);
  return sellable.length > 0 ? sellable : all;
}

export function getPurchasableUnits(product: Product, units: ProductUnit[] | undefined): ProductUnit[] {
  const all = getAllUnits(product, units);
  const purchasable = all.filter((u) => u.canPurchase);
  return purchasable.length > 0 ? purchasable : all;
}

/** Look a unit up by id within a product's unit list (falls back to default). */
export function getUnitById(
  product: Product,
  units: ProductUnit[] | undefined,
  unitId: string | undefined,
): ProductUnit {
  const all = getAllUnits(product, units);
  return all.find((u) => u.id === unitId) ?? getDefaultProductUnit(product, units);
}

/**
 * The unit the POS should add to the cart by default: the explicit
 * `defaultSaleUnitId`, else the `isDefaultSaleUnit` flag, else the first
 * sellable unit. Always returns a unit (legacy fallback for unit/weight).
 */
export function getDefaultProductUnit(product: Product, units: ProductUnit[] | undefined): ProductUnit {
  const all = getAllUnits(product, units);
  if (product.defaultSaleUnitId) {
    const explicit = all.find((u) => u.id === product.defaultSaleUnitId);
    if (explicit) return explicit;
  }
  const flagged = all.find((u) => u.isDefaultSaleUnit && u.canSell);
  if (flagged) return flagged;
  const firstSellable = all.find((u) => u.canSell);
  return firstSellable ?? all[0];
}

/**
 * The default unit to RECEIVE stock in: default purchasable → default sale unit
 * (if purchasable) → first purchasable. Always returns a unit.
 */
export function getDefaultPurchaseUnit(product: Product, units: ProductUnit[] | undefined): ProductUnit {
  const purchasable = getPurchasableUnits(product, units);
  const defaultSale = getDefaultProductUnit(product, units);
  if (defaultSale.canPurchase && purchasable.some((u) => u.id === defaultSale.id)) {
    return defaultSale;
  }
  return purchasable[0];
}

/** Convert a quantity expressed in `unit` to the integer base-unit count. */
export function toBaseQuantity(
  quantity: number,
  unit: Pick<ProductUnit, 'conversionToBase'>,
): number {
  const conversion = Number(unit.conversionToBase) || 1;
  return Math.round((Number(quantity) || 0) * conversion);
}

/**
 * Find the ProductUnit whose barcode matches `barcode`, scanning a product's
 * units. Returns undefined when no unit barcode matches.
 */
export function findUnitByBarcode(units: ProductUnit[], barcode: string): ProductUnit | undefined {
  const target = barcode.trim();
  if (!target) return undefined;
  return units.find((u) => (u.barcode ?? '').trim() === target);
}

export interface StockBreakdownPart {
  unitId: string;
  unitName: string;
  count: number;
}

/**
 * Greedily decompose a base-unit count into the product's units, largest unit
 * first: 1477 pills (box=150, strip=10, pill=1) → [9 box, 12 strip, 7 pill].
 * Units with a zero count are dropped. Falls back to a single base-unit part.
 */
export function getStockBreakdownParts(
  product: Product,
  units: ProductUnit[] | undefined,
  baseQuantity: number,
): StockBreakdownPart[] {
  const safe = Math.max(0, Math.round(Number(baseQuantity) || 0));
  const ordered = [...getAllUnits(product, units)].sort(
    (a, b) => b.conversionToBase - a.conversionToBase,
  );
  // Deduplicate conversions (two units with the same size collapse to one) and
  // guarantee a conversion-1 bucket so the remainder is always representable.
  const seen = new Set<number>();
  const buckets = ordered.filter((u) => {
    const c = Math.max(1, Math.floor(u.conversionToBase));
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });
  if (!seen.has(1)) {
    buckets.push(buildLegacyUnit(product));
  }

  const parts: StockBreakdownPart[] = [];
  let remaining = safe;
  for (const unit of buckets) {
    const conversion = Math.max(1, Math.floor(unit.conversionToBase));
    const count = Math.floor(remaining / conversion);
    if (count > 0) {
      parts.push({ unitId: unit.id, unitName: unit.name, count });
      remaining -= count * conversion;
    }
  }
  if (parts.length === 0) {
    parts.push({ unitId: LEGACY_UNIT_ID, unitName: getBaseUnitName(product), count: 0 });
  }
  return parts;
}

/**
 * Human-readable mixed-unit stock string, e.g. "9 box + 12 strip + 7 pill".
 * Unit names are user-defined free text, so they are shown as-is (no
 * pluralization) — this stays correct under RTL and for any language.
 */
export function formatStockBreakdown(
  product: Product,
  units: ProductUnit[] | undefined,
  baseQuantity: number,
): string {
  return getStockBreakdownParts(product, units, baseQuantity)
    .map((part) => `${part.count} ${part.unitName}`)
    .join(' + ');
}

/** "1477 pill" — the raw base total with the base unit name (tooltip/detail). */
export function formatBaseTotal(product: Product, baseQuantity: number): string {
  const safe = Math.max(0, Math.round(Number(baseQuantity) || 0));
  return `${safe} ${getBaseUnitName(product)}`;
}

/**
 * Unified stock display for any product. multi_unit → mixed-unit breakdown
 * ("9 box + 12 strip + 7 pill"); weight → compact weight; unit → plain count.
 * The single call site the inventory/product tables can use without branching.
 */
export function formatProductStock(
  product: Product,
  units: ProductUnit[] | undefined,
  baseQuantity: number,
): string {
  if (getProductSaleType(product) === 'multi_unit') {
    return formatStockBreakdown(product, units, baseQuantity);
  }
  return formatStockDisplay(product.saleType, baseQuantity);
}

// ── Quick templates for the product form ────────────────────────────────────

export interface UnitTemplateRow {
  /** i18n key under the `multiUnit` namespace for the default unit name. */
  nameKey: string;
  conversionToBase: number;
  canSell: boolean;
  canPurchase: boolean;
  isDefaultSaleUnit: boolean;
}

/** Pharmacy tablets: box / strip / pill (pill is base, strip is default sale). */
export const PHARMACY_UNIT_TEMPLATE: UnitTemplateRow[] = [
  { nameKey: 'pill', conversionToBase: 1, canSell: true, canPurchase: false, isDefaultSaleUnit: false },
  { nameKey: 'strip', conversionToBase: 10, canSell: true, canPurchase: true, isDefaultSaleUnit: true },
  { nameKey: 'box', conversionToBase: 150, canSell: true, canPurchase: true, isDefaultSaleUnit: false },
];

/** Supermarket packs: carton / pack / piece (piece is base, piece is default). */
export const SUPERMARKET_UNIT_TEMPLATE: UnitTemplateRow[] = [
  { nameKey: 'piece', conversionToBase: 1, canSell: true, canPurchase: true, isDefaultSaleUnit: true },
  { nameKey: 'pack', conversionToBase: 6, canSell: true, canPurchase: true, isDefaultSaleUnit: false },
  { nameKey: 'carton', conversionToBase: 24, canSell: true, canPurchase: true, isDefaultSaleUnit: false },
];

/** Heuristic: does a category look like a pharmacy (to suggest the template)? */
export function looksLikePharmacy(category: string | undefined): boolean {
  const c = (category ?? '').toLowerCase();
  return (
    c.includes('pharm') ||
    c.includes('drug') ||
    c.includes('medic') ||
    c.includes('صيدل') ||
    c.includes('دواء') ||
    c.includes('أدوية') ||
    c.includes('ادوية')
  );
}

// ── Validation ───────────────────────────────────────────────────────────────

export type MultiUnitIssueCode =
  | 'no_units'
  | 'no_sellable'
  | 'no_default'
  | 'multiple_default'
  | 'no_base'
  | 'empty_name'
  | 'bad_conversion'
  | 'duplicate_barcode';

export interface MultiUnitValidationIssue {
  code: MultiUnitIssueCode;
  /** Index of the offending unit row, when the issue is row-specific. */
  index?: number;
}

/** The minimal unit shape the validator needs (works on form drafts too). */
export interface UnitDraftLike {
  name: string;
  conversionToBase: number;
  barcode?: string;
  canSell: boolean;
  canPurchase?: boolean;
  isDefaultSaleUnit?: boolean;
}

/**
 * Validate a multi_unit product's units. Returns an empty array when valid.
 * Enforces: ≥1 unit, ≥1 sellable, exactly one default (among sellable), exactly
 * one base unit (conversion 1), non-empty names, positive-integer conversions,
 * and no duplicate barcodes within the set.
 */
export function validateUnitDrafts(units: UnitDraftLike[]): MultiUnitValidationIssue[] {
  const issues: MultiUnitValidationIssue[] = [];
  if (units.length === 0) {
    issues.push({ code: 'no_units' });
    return issues;
  }

  if (!units.some((u) => u.canSell)) issues.push({ code: 'no_sellable' });

  const defaults = units.filter((u) => u.isDefaultSaleUnit);
  if (defaults.length === 0) issues.push({ code: 'no_default' });
  if (defaults.length > 1) issues.push({ code: 'multiple_default' });

  if (!units.some((u) => Number(u.conversionToBase) === 1)) issues.push({ code: 'no_base' });

  const seenBarcodes = new Map<string, number>();
  units.forEach((unit, index) => {
    if (!unit.name?.trim()) issues.push({ code: 'empty_name', index });
    const conversion = Number(unit.conversionToBase);
    if (!Number.isInteger(conversion) || conversion <= 0) {
      issues.push({ code: 'bad_conversion', index });
    }
    const barcode = (unit.barcode ?? '').trim();
    if (barcode) {
      if (seenBarcodes.has(barcode)) {
        issues.push({ code: 'duplicate_barcode', index });
      } else {
        seenBarcodes.set(barcode, index);
      }
    }
  });

  return issues;
}

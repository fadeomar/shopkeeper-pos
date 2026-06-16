/**
 * Sell-price editing rules for the POS cart.
 *
 * Every user may edit a line's sell price during checkout (the shop owner
 * asked to be able to negotiate a price down at the counter). The only guard
 * is the cost floor:
 *   - Misc / open-price lines have no real cost — cost tracks the price, so
 *     they never trip the below-cost guard.
 *   - Users WITHOUT canEditCost cannot sell below the line's unit cost: the
 *     committed price is floored at cost.
 *   - Users WITH canEditCost may sell below cost (e.g. clearing stock) and
 *     instead get a non-blocking below-cost warning.
 *
 * Kept here as pure functions so the rule is unit-tested directly rather than
 * only through the heavy POS component.
 */

export interface SellPriceContext {
  /** The price the cashier typed (any sign / NaN tolerated). */
  price: number;
  /** The line's unit cost (per sold unit / per kg). */
  unitCost: number;
  /** Misc / open-price line — no real cost basis. */
  isMisc: boolean;
  /** Whether the current user may sell below cost. */
  canEditCost: boolean;
}

/** Sanitize a typed price to a non-negative finite number. */
export function sanitizeSellPrice(price: number): number {
  return Number.isFinite(price) ? Math.max(0, price) : 0;
}

/**
 * The sell price actually committed to the cart line, after applying the cost
 * floor for users who can't override it. Misc and privileged users float at 0.
 */
export function resolveSellPrice(ctx: SellPriceContext): number {
  const safe = sanitizeSellPrice(ctx.price);
  if (ctx.isMisc || ctx.canEditCost) return safe;
  return Math.max(safe, ctx.unitCost);
}

/**
 * The lowest price the price input should allow. A hard floor at cost for
 * restricted users; 0 for misc lines and users who may override.
 */
export function sellPriceFloor(
  isMisc: boolean,
  canEditCost: boolean,
  unitCost: number,
): number {
  return !isMisc && !canEditCost ? unitCost : 0;
}

/**
 * Whether a committed line is being sold below its cost. Only reachable by
 * users with canEditCost (others are floored), used to surface the
 * non-blocking warning.
 */
export function isBelowCost(
  isMisc: boolean,
  unitSellPrice: number,
  unitCost: number,
): boolean {
  return !isMisc && unitSellPrice < unitCost;
}

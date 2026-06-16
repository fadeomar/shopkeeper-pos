/**
 * Sell-price editing rules for the POS cart.
 *
 * Every user may edit a line's sell price during checkout (the shop owner
 * asked to be able to negotiate a price down at the counter). The only guard
 * is the cost floor:
 *   - Misc / open-price lines have no real cost — cost tracks the price, so
 *     they never trip the below-cost guard.
 *   - When below-cost selling is NOT permitted, the committed price is floored
 *     at the line's unit cost.
 *   - When it IS permitted, the price may dip below cost (e.g. clearing stock)
 *     and instead surfaces a non-blocking below-cost warning.
 *
 * `canSellBelowCost` is the COMBINED gate `canEditCost && settings.allowLossSale`
 * — both must hold. The service (`assertLossSaleAllowed`) rejects below-cost
 * sales when `allowLossSale` is false, so the UI must hard-floor in that case
 * or the cashier would see the sale "succeed" in the cart and then fail at
 * finalize. The per-user `canEditCost` flag is the second condition.
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
  /** `canEditCost && settings.allowLossSale` — both conditions required. */
  canSellBelowCost: boolean;
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
  if (ctx.isMisc || ctx.canSellBelowCost) return safe;
  return Math.max(safe, ctx.unitCost);
}

/**
 * The lowest price the price input should allow. A hard floor at cost when
 * below-cost selling isn't permitted; 0 for misc lines and when it is.
 */
export function sellPriceFloor(
  isMisc: boolean,
  canSellBelowCost: boolean,
  unitCost: number,
): number {
  return !isMisc && !canSellBelowCost ? unitCost : 0;
}

/**
 * Whether a committed line is being sold below its cost. Only reachable when
 * below-cost selling is permitted (others are floored), used to surface the
 * non-blocking warning.
 */
export function isBelowCost(
  isMisc: boolean,
  unitSellPrice: number,
  unitCost: number,
): boolean {
  return !isMisc && unitSellPrice < unitCost;
}

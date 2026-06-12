/**
 * Shared paid-amount logic for the POS and purchase entry screens.
 *
 * Both screens auto-fill the paid amount to the full total (or 0 for a credit
 * sale/purchase) until the cashier overrides it, and both reconstruct the
 * "was it manually edited?" flag when recovering a saved draft. Keeping this in
 * one tested module prevents the two screens from drifting apart — historically
 * the purchase screen shipped without the credit-aware guard at all.
 */

/** Float tolerance for paid-amount comparisons (two-decimal currency). */
export const PAID_AMOUNT_EPSILON = 0.001;

/**
 * The credit-aware auto-fill default: a credit sale/purchase owes 0 up front;
 * everything else defaults to the full total, rounded to two decimals.
 */
export function creditAwareDefaultPaidAmount(
  paymentMethod: string | undefined,
  total: number,
): number {
  if (paymentMethod === "credit") return 0;
  return Number((Number.isFinite(total) ? total : 0).toFixed(2));
}

/**
 * Reconstruct whether the cashier manually overrode the paid amount, by
 * comparing a draft-recovered paid amount against the credit-aware default.
 * This stops a restored credit draft (paidAmount 0) from being mistaken for a
 * manual override.
 */
export function wasPaidAmountManuallyEdited(
  savedPaidAmount: number | undefined,
  paymentMethod: string | undefined,
  autoTotal: number,
): boolean {
  const expectedDefault = creditAwareDefaultPaidAmount(paymentMethod, autoTotal);
  return Math.abs((savedPaidAmount ?? 0) - expectedDefault) > PAID_AMOUNT_EPSILON;
}

/**
 * The paid amount actually submitted: the cashier's value when they overrode
 * it, otherwise the credit-aware default.
 */
export function resolveActualPaidAmount(
  isManuallyEdited: boolean,
  watchedPaidAmount: number,
  defaultPaidAmount: number,
): number {
  return isManuallyEdited ? watchedPaidAmount : defaultPaidAmount;
}

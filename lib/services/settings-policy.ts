import { AppError, AppErrorCode } from "@/lib/errors/app-error";
import type { PaymentMethod, Settings } from "@/types/domain";

/**
 * Authoritative settings-driven rules shared by billing-service and
 * purchase-service. The POS/purchase UIs enforce these too, but the service
 * layer is the source of truth: an old PWA cache or a future direct caller
 * must never be able to write data that violates store policy (bad data would
 * otherwise sync to the cloud and skew supplier balances / drawer / reports).
 */

/**
 * Reject a payment method the store has disabled. `undefined` means enabled
 * (historical default). "mixed" requires both cash and card to be on.
 */
export function assertPaymentMethodEnabled(
  settings: Settings,
  method: PaymentMethod,
): void {
  const cashOn = settings.enableCash !== false;
  const cardOn = settings.enableCard !== false;
  const creditOn = settings.enableCredit !== false;
  const ok =
    (method === "cash" && cashOn) ||
    (method === "card" && cardOn) ||
    (method === "credit" && creditOn) ||
    (method === "mixed" && cashOn && cardOn);
  if (!ok) {
    throw new AppError(AppErrorCode.PAYMENT_METHOD_DISABLED);
  }
}

/**
 * The tax amount that may actually ride along on a bill/purchase.
 *
 * Only `exclusive` mode adds a manual tax amount on top of the total. `none`
 * and `inclusive` force 0 — there is no tax-rate engine yet, so an "inclusive"
 * manual amount would be double-counted by `total = subtotal - discount + tax`.
 * Normalising here means a stale client that still renders the tax field can't
 * slip a non-zero amount through when the mode forbids it.
 */
export function effectiveTaxAmount(
  settings: Settings,
  taxAmount: number,
): number {
  return settings.taxMode === "exclusive" ? taxAmount : 0;
}

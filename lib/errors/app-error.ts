/**
 * Typed application error codes. Services throw AppError instead of plain
 * Error so that components can translate the message via getServiceErrorMessage
 * without threading `t()` through the service layer.
 *
 * Convention: upper-snake-case, domain prefix.
 */
export const AppErrorCode = {
  // ── Product line validation (billing + purchase) ──────────────────────────
  PRODUCT_INACTIVE: 'PRODUCT_INACTIVE',
  PRODUCT_QTY_WHOLE: 'PRODUCT_QTY_WHOLE',
  PRODUCT_QTY_POSITIVE: 'PRODUCT_QTY_POSITIVE',
  PRODUCT_INSUFFICIENT_STOCK: 'PRODUCT_INSUFFICIENT_STOCK',
  PRODUCT_LOSS_SALE_BLOCKED: 'PRODUCT_LOSS_SALE_BLOCKED',
  PRODUCT_QTY_POSITIVE_WHOLE: 'PRODUCT_QTY_POSITIVE_WHOLE',
  PRODUCT_UNIT_COST_NEGATIVE: 'PRODUCT_UNIT_COST_NEGATIVE',
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',

  // ── Shared bill / purchase validation ─────────────────────────────────────
  DISCOUNT_TOO_HIGH: 'DISCOUNT_TOO_HIGH',
  DISCOUNT_EXCEEDS_LIMIT: 'DISCOUNT_EXCEEDS_LIMIT',
  PRODUCTS_MISSING: 'PRODUCTS_MISSING',
  LINE_PRODUCT_NOT_FOUND: 'LINE_PRODUCT_NOT_FOUND',
  VOID_REASON_REQUIRED: 'VOID_REASON_REQUIRED',
  RETURN_REASON_REQUIRED: 'RETURN_REASON_REQUIRED',
  RETURN_QTY_INVALID: 'RETURN_QTY_INVALID',
  RETURN_EXCEEDS_QTY: 'RETURN_EXCEEDS_QTY',

  // ── Bill-specific ──────────────────────────────────────────────────────────
  BILL_NO_ITEMS: 'BILL_NO_ITEMS',
  BILL_CREDIT_NEEDS_CUSTOMER: 'BILL_CREDIT_NEEDS_CUSTOMER',
  BILL_PAID_TOO_LOW: 'BILL_PAID_TOO_LOW',
  BILL_MIXED_SPLIT_MISMATCH: 'BILL_MIXED_SPLIT_MISMATCH',
  BILL_PAYMENT_SPLIT_INVALID: 'BILL_PAYMENT_SPLIT_INVALID',
  BILL_NOT_FOUND: 'BILL_NOT_FOUND',
  BILL_ALREADY_VOIDED: 'BILL_ALREADY_VOIDED',
  BILL_NOT_FINALIZED: 'BILL_NOT_FINALIZED',
  BILL_ITEM_NOT_FOUND: 'BILL_ITEM_NOT_FOUND',
  BILL_VOIDED_NO_RETURN: 'BILL_VOIDED_NO_RETURN',
  BILL_SHIFT_REQUIRED: 'BILL_SHIFT_REQUIRED',

  // ── Purchase-specific ──────────────────────────────────────────────────────
  PURCHASE_NO_ITEMS: 'PURCHASE_NO_ITEMS',
  PURCHASE_CREDIT_NEEDS_SUPPLIER: 'PURCHASE_CREDIT_NEEDS_SUPPLIER',
  PURCHASE_PAID_TOO_LOW: 'PURCHASE_PAID_TOO_LOW',
  PURCHASE_MIXED_SPLIT_MISMATCH: 'PURCHASE_MIXED_SPLIT_MISMATCH',
  PURCHASE_NOT_FOUND: 'PURCHASE_NOT_FOUND',
  PURCHASE_ALREADY_VOIDED: 'PURCHASE_ALREADY_VOIDED',
  PURCHASE_NOT_FINALIZED: 'PURCHASE_NOT_FINALIZED',
  PURCHASE_ITEM_NOT_FOUND: 'PURCHASE_ITEM_NOT_FOUND',
  PURCHASE_VOIDED_NO_RETURN: 'PURCHASE_VOIDED_NO_RETURN',
  PURCHASE_VOID_INSUFFICIENT_STOCK: 'PURCHASE_VOID_INSUFFICIENT_STOCK',
  PURCHASE_RETURN_INSUFFICIENT_STOCK: 'PURCHASE_RETURN_INSUFFICIENT_STOCK',

  // ── Shift ──────────────────────────────────────────────────────────────────
  SHIFT_OPENING_CASH_NEGATIVE: 'SHIFT_OPENING_CASH_NEGATIVE',
  SHIFT_ALREADY_OPEN: 'SHIFT_ALREADY_OPEN',
  SHIFT_COUNTED_CASH_NEGATIVE: 'SHIFT_COUNTED_CASH_NEGATIVE',
  SHIFT_NOT_FOUND: 'SHIFT_NOT_FOUND',
  SHIFT_ALREADY_CLOSED: 'SHIFT_ALREADY_CLOSED',

  // ── Stock / inventory ──────────────────────────────────────────────────────
  STOCK_ADJ_ZERO_OR_WHOLE: 'STOCK_ADJ_ZERO_OR_WHOLE',
  STOCK_ADJ_NEGATIVE_RESULT: 'STOCK_ADJ_NEGATIVE_RESULT',
  STOCK_RECEIVED_QTY_INVALID: 'STOCK_RECEIVED_QTY_INVALID',
  STOCK_COUNTED_QTY_INVALID: 'STOCK_COUNTED_QTY_INVALID',

  // ── Payments ───────────────────────────────────────────────────────────────
  CUSTOMER_REQUIRED: 'CUSTOMER_REQUIRED',
  SUPPLIER_REQUIRED: 'SUPPLIER_REQUIRED',
  PAYMENT_AMOUNT_INVALID: 'PAYMENT_AMOUNT_INVALID',
  // Shared by bills + purchases — a disabled payment method was submitted.
  PAYMENT_METHOD_DISABLED: 'PAYMENT_METHOD_DISABLED',
  // The current user's role lacks the permission for this action.
  PERMISSION_DENIED: 'PERMISSION_DENIED',

  // ── Import ─────────────────────────────────────────────────────────────────
  IMPORT_DUPLICATES: 'IMPORT_DUPLICATES',
} as const;

export type AppErrorCode = (typeof AppErrorCode)[keyof typeof AppErrorCode];

/**
 * Structured error thrown by service functions. Components should pass this
 * to getServiceErrorMessage(error, t) to get a localized string rather than
 * displaying error.message (which is always English).
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly params?: Record<string, string | number>;

  constructor(code: AppErrorCode, params?: Record<string, string | number>) {
    // Keep an English fallback message so server logs and console output are
    // still readable without a translation table.
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.params = params;
  }
}

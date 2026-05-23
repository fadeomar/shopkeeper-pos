const CENTS_PER_UNIT = 100;

/** Half-cent tolerance used across all payment split validations. */
export const MONEY_EPSILON = 0.005;

export function toCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * CENTS_PER_UNIT);
}

export function fromCents(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return cents / CENTS_PER_UNIT;
}

export function addMoney(...values: number[]): number {
  return fromCents(values.reduce((sum, value) => sum + toCents(value), 0));
}

export function subtractMoney(
  value: number,
  ...subtractValues: number[]
): number {
  return fromCents(
    subtractValues.reduce((sum, item) => sum - toCents(item), toCents(value)),
  );
}

export function multiplyMoney(value: number, quantity: number): number {
  if (!Number.isFinite(quantity)) return 0;
  return fromCents(Math.round(toCents(value) * quantity));
}

export function allocateMoney(total: number, ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return fromCents(Math.round(toCents(total) * ratio));
}

export function roundMoney(value: number) {
  return fromCents(toCents(value));
}

/**
 * Map currency symbols to ISO 4217 codes accepted by Intl.NumberFormat.
 * Stored settings may contain symbols (e.g. "₪") instead of codes; normalise
 * them here so we never throw a RangeError.
 */
const SYMBOL_TO_ISO: Record<string, string> = {
  "₪": "ILS",
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₩": "KRW",
  "₹": "INR",
  "﷼": "SAR",
  "د.إ": "AED",
  "JD": "JOD",
};

export function normalizeCurrencyCode(code: string): string {
  return SYMBOL_TO_ISO[code.trim()] ?? code;
}

export function formatCurrency(value: number, currency = "ILS") {
  const code = normalizeCurrencyCode(currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(roundMoney(value));
  } catch {
    // Fallback for unrecognised ISO codes (e.g. typos stored in settings)
    // so a bad currency value never crashes a render.
    return `${code} ${roundMoney(value).toFixed(2)}`;
  }
}

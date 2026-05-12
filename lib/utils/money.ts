const CENTS_PER_UNIT = 100;

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

export function subtractMoney(value: number, ...subtractValues: number[]): number {
  return fromCents(subtractValues.reduce((sum, item) => sum - toCents(item), toCents(value)));
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

export function formatCurrency(value: number, currency = 'USD') {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(roundMoney(value));
}

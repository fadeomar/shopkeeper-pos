// Retail barcode formats supported by the scanner.
// ZXing handles detection internally; this module normalizes the raw result.

export const RETAIL_BARCODE_FORMATS = [
  'EAN_13',
  'EAN_8',
  'UPC_A',
  'UPC_E',
  'CODE_128',
  'CODE_39',
  'ITF',
] as const;

/** Strip whitespace from a raw ZXing result string. */
export function normalizeBarcode(raw: string): string {
  return raw.trim();
}

/** Minimum viability check — barcode schema enforces min 3 chars anyway. */
export function isValidBarcode(value: string): boolean {
  return normalizeBarcode(value).length >= 3;
}

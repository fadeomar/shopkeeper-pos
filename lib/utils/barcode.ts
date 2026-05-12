// Retail barcode formats supported by the scanner. Keep this list narrow so QR
// codes or unrelated labels do not accidentally become product barcodes.
export const RETAIL_BARCODE_FORMATS = [
  'EAN_13',
  'EAN_8',
  'UPC_A',
  'UPC_E',
  'CODE_128',
  'CODE_39',
  'ITF',
] as const;

export const NATIVE_RETAIL_BARCODE_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'itf',
] as const;

/** Strip whitespace from a camera/manual barcode value without changing meaningful symbols. */
export function normalizeBarcode(raw: string): string {
  return raw.trim().replace(/\s+/g, '');
}

/**
 * Product barcodes may be retail numeric codes or internal Code 128/39 labels.
 * Keep validation permissive enough for shop-created labels, but reject empty,
 * very long, or non-printable values.
 */
export function isValidBarcode(value: string): boolean {
  const normalized = normalizeBarcode(value);
  return /^[A-Za-z0-9._-]{3,64}$/.test(normalized);
}

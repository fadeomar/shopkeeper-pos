import { describe, expect, it } from 'vitest';
import { isValidBarcode, normalizeBarcode, NATIVE_RETAIL_BARCODE_FORMATS, RETAIL_BARCODE_FORMATS } from '@/lib/utils/barcode';

describe('barcode utilities', () => {
  it('normalizes barcode values by removing whitespace only', () => {
    expect(normalizeBarcode('  729 000-ABC  ')).toBe('729000-ABC');
  });

  it('accepts retail numeric and internal shop label barcodes', () => {
    expect(isValidBarcode('7290001234567')).toBe(true);
    expect(isValidBarcode('CODE_128-BOX-01')).toBe(true);
    expect(isValidBarcode('ab_12-34.56')).toBe(true);
  });

  it('rejects empty, too-short, too-long, and non-printable/symbol-heavy values', () => {
    expect(isValidBarcode('')).toBe(false);
    expect(isValidBarcode('12')).toBe(false);
    expect(isValidBarcode('a'.repeat(65))).toBe(false);
    expect(isValidBarcode('abc#123')).toBe(false);
  });

  it('keeps the scanner format allowlist narrow', () => {
    expect(RETAIL_BARCODE_FORMATS).not.toContain('QR_CODE' as never);
    expect(NATIVE_RETAIL_BARCODE_FORMATS).not.toContain('qr_code' as never);
  });
});

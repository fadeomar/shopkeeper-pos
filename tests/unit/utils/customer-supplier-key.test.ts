import { describe, expect, it } from 'vitest';
import { normalizeCustomerKey, normalizeName, normalizePhone } from '@/lib/utils/customer-key';
import { normalizeSupplierKey } from '@/lib/utils/supplier-key';

describe('customer and supplier identity keys', () => {
  it('normalizes phone numbers to digits and prefers phone over name', () => {
    expect(normalizePhone('+970 599-123-456')).toBe('970599123456');
    expect(normalizeCustomerKey({ name: 'Ali Store', phone: '+970 599-123-456' })).toBe('phone:970599123456');
  });

  it('normalizes names when a phone number is missing', () => {
    expect(normalizeName('  Ali   Store  ')).toBe('ali store');
    expect(normalizeCustomerKey({ name: '  Ali   Store  ' })).toBe('name:ali store');
  });

  it('returns an empty key when no stable customer identity exists', () => {
    expect(normalizeCustomerKey({ name: '   ', phone: '---' })).toBe('');
  });

  it('uses the same identity rules for suppliers', () => {
    expect(normalizeSupplierKey({ name: 'Main Supplier' })).toBe('name:main supplier');
    expect(normalizeSupplierKey({ name: 'Main Supplier', phone: '0599 111 222' })).toBe('phone:0599111222');
  });
});

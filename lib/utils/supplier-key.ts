/**
 * Supplier-key helpers. The normalisation logic is identical to the customer
 * side — same digit-only phone stripping, same legacy `phone:`/`name:` key
 * format — so this module re-exports the existing implementations under
 * supplier-themed names. Keeps the call sites self-documenting without
 * forking the implementation.
 */
export { normalizePhone, normalizeName } from './customer-key';
import { normalizeCustomerKey } from './customer-key';

export const normalizeSupplierKey = normalizeCustomerKey;

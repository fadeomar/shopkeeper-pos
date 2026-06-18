# Light UX Improvements Sprint

Implemented as low-risk quality-of-life changes that preserve the current user workflow.

## Changes

- Added `usePersistedState` for safe localStorage-backed UI state with graceful fallback when storage is unavailable.
- Products page now remembers search query and category filter between navigation/refresh.
- Bills page now remembers search/date/payment/status/cashier/custom-range filters.
- Purchases page now remembers search/date/supplier/payment-status/custom-range filters.
- Shared `DataTable` can now persist table search, sorting, page index, and page size when a `storageKey` is provided.
- Enabled DataTable persistence on Products, Bills, and Purchases desktop tables.
- Improved product search ranking:
  1. exact barcode match
  2. barcode starts with query
  3. name starts with query
  4. barcode contains query
  5. name contains query

## Behavior notes

- No database schema changes.
- No route changes.
- No permission changes.
- No cashier workflow changes.
- Stored UI preferences are local to the current browser/device only.

## Verification notes

- I attempted `npm run typecheck`, but the uploaded package did not include a complete `node_modules` install and dependency installation could not complete inside this sandbox. The attempted typecheck failed on missing packages such as React/Next/Playwright rather than on the edited code paths.
- Locally, run:

```bash
npm install
npm run typecheck
npm run build
```

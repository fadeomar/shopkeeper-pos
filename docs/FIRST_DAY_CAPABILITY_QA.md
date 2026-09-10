# First-day capability QA

This report maps the setup guidance exposed by `/guide/getting-started` to capabilities that already exist in Asas POS. The guide must not promise migration or accounting workflows that the app cannot represent safely.

## Capability matrix

| Scenario | Status | Supported path | Notes |
| --- | --- | --- | --- |
| Brand-new shop with recent supplier invoices | SUPPORTED | `/purchases/new` | A purchase can resolve/create the supplier, create missing products inline, increase stock, create stock movements, and create FIFO lots. |
| Existing physical stock, no prior POS/accounting system | SUPPORTED | `/products` | Product creation can record positive opening stock and seed the corresponding opening inventory lot. |
| Existing product spreadsheet | SUPPORTED | `/products` CSV import | Import preview validates required columns and duplicate barcodes. Positive imported quantities receive stock movements and opening FIFO lots. |
| Move product catalogue/current stock from another system | PARTIAL | Export old catalogue → Asas CSV template → `/products` | Product/current-stock cut-over is supported. Full historical migration is not. |
| Add supplier before activity | SUPPORTED | `/suppliers` | Supplier directory supports manual creation. A supplier can also be resolved/created naturally from a purchase. |
| Add customer before activity | SUPPORTED | `/customers` | Customer directory supports manual creation. Customers can then be used for credit sales/account tracking. |
| Record new supplier debt | SUPPORTED | `/purchases/new` | Credit on a finalized purchase contributes to the supplier ledger. |
| Record new customer debt | SUPPORTED | `/billing` | Credit on a finalized bill contributes to the customer ledger. |
| Import legacy customer debt/opening A/R | NOT SUPPORTED | — | The “opening balance” shown in statements is calculated from activity before the selected report period; it is not an editable migration balance. |
| Import legacy supplier debt/opening A/P | NOT SUPPORTED | — | Same limitation as customer debt. Do not create fake purchases/payments solely to migrate balances. |
| Import old bills/purchases/accounting history | NOT SUPPORTED | — | No general historical transaction importer exists. Keep the prior system/export as the historical reference after cut-over. |
| Inventory count/correction after go-live | SUPPORTED | `/inventory` | Inventory adjustments are the correct path for physical count corrections after setup. |
| First cash session | SUPPORTED | `/shift` | Opening cash is captured and the shift can later be reconciled. Whether a shift is strictly required depends on store settings, but opening one is the recommended first-day workflow. |
| First sale | SUPPORTED | `/billing` | Search/scan products, choose quantity/payment, finalize bill, reduce stock, and consume FIFO inventory. |
| First-day work while offline | PARTIAL / EXPECTED | Operational routes | Existing authenticated/trusted sessions and operational data are designed to work offline. First sign-in/new-device restore still requires internet. |
| Multi-branch stock/sales management | NOT SUPPORTED | — | Current product positioning is a single small shop/store; the public guide already calls multi-branch aggregation out as “not yet”. |
| Clothing size/color variant matrix | NOT SUPPORTED AS A FIRST-CLASS MODEL | Separate SKU/product per variant | A shop can use one product/SKU per size/color combination, but there is no first-class style → color → size variant matrix. |

## Verified implementation evidence

- `lib/services/purchase-service.ts`: finalized purchases resolve/create suppliers, update stock, create stock movements, and create FIFO purchase lots in the same transaction.
- `features/purchases/components/purchase-quick-product-modal.tsx`: a missing product can be created inline from the purchase flow with zero opening stock so the purchase remains the stock-receipt source.
- `lib/services/inventory-service.ts` and `lib/services/product-unit-service.ts`: positive stock entered during product creation creates the initial stock movement and opening lot.
- `lib/services/product-import-service.ts`: CSV preview validates required fields/duplicates; import creates products, initial movements, and opening lots for positive quantities.
- `lib/services/customer-ledger-service.ts`: customer balance is derived from credit bills and recorded payments; there is no persisted editable opening-debt field.
- `lib/services/supplier-ledger-service.ts`: supplier balance is derived from purchases and supplier payments; there is no persisted editable opening-debt field.
- `features/customers/components/customer-ledger-workspace.tsx` and `features/suppliers/components/supplier-ledger-workspace.tsx`: both directories support manual quick-add flows.

## Guide decisions

The first-day guide should route users by starting condition instead of prescribing one setup order to everyone:

1. **New stock with purchase invoices** → start with a purchase.
2. **Existing stock already on shelves** → create products with opening stock.
3. **Existing Excel/CSV list** → use product import and preview.
4. **Moving from another system** → migrate catalogue/current stock only, clearly disclose that legacy debts/history are not generally importable.

After stock is loaded, the shared recommended flow is: review store settings → verify inventory → open shift → make first sale.

## Manual QA checklist before merge

- Logged out: open `/guide` and reach `/guide/getting-started` without authentication.
- Logged out: each scenario CTA routes to sign-in rather than an operational page.
- Logged in as a store user: desktop sidebar shows Getting started and opens the public guide successfully.
- Logged in on mobile: More → Guide is visible and opens the same page.
- Logged in: public header says “Back to app” / “العودة إلى التطبيق”, not Sign in.
- Arabic: verify RTL card order, numbered steps, wrapping, and all CTAs.
- English: verify layout and wrapping on phone and desktop widths.
- Dashboard with no products/bills: primary CTA opens Getting started; purchase and product shortcuts are both present.
- New purchase: create a supplier and a missing product inline, finalize purchase, then confirm stock increased.
- Existing stock: create a product with opening quantity, then confirm Inventory and FIFO-backed sale work.
- CSV: download template, import a valid row with quantity, then confirm product/stock appears.
- Migration copy: confirm the page explicitly warns that legacy invoices and customer/supplier debts are not generally imported.
- Offline cache: after the service worker reports ready, navigate to `/guide/getting-started` offline.

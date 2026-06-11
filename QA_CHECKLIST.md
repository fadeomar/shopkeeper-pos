# QA Checklist — Final UX/UI Audit

## 1. Auth and language
- Sign in in English and Arabic.
- Confirm email/password labels, validation, loading state, and error messages are translated.
- Switch to Arabic and confirm RTL layout.

## 2. Navigation
- Desktop sidebar: verify every nav item routes correctly.
- Mobile nav: verify short labels are translated in English and Arabic.
- Confirm active route state is visible and touch-friendly.

## 3. Admin
- Open Admin Users list.
- Confirm pending approvals can be approved/rejected.
- Confirm users table supports search, sorting, pagination, empty/loading states, and horizontal mobile scroll.
- Confirm active/inactive toggle still works.
- Open a user detail page and verify support exports/reset link/status actions still work.

## 4. Products
- Create, edit, activate/deactivate, and adjust stock.
- Verify product table search, category filter, pagination, mobile cards, prices, status, and sync badge.

## 5. Inventory
- Open stock count modal.
- Search products with the searchable dropdown by name/barcode.
- Save a stock count and confirm movement history updates.
- Verify movement history table pagination, search, and empty state.

## 6. Billing/POS
- Search and add product by searchable dropdown.
- Add product by barcode and scanner modal.
- Change quantity and remove items.
- Test cash, card, credit, and mixed payments.
- Verify subtotal, discount, tax, paid amount, change, and remaining due.
- Finalize bill and verify receipt output and stock reduction.
- Confirm customer ledger updates after credit/customer payments.

## 7. Purchases
- Search and add product by searchable dropdown.
- Change quantity/unit cost and remove items.
- Select/add supplier.
- Verify subtotal, discount, tax, paid amount, change/remaining due.
- Finalize purchase and verify stock increase and supplier ledger update.

## 8. Customers ledger
- Verify totals: credit sales, paid, balance due, customers with debt.
- Verify ledger table search, sorting, pagination, empty/loading states, and mobile horizontal scroll.
- Open details modal and record a payment.
- Verify overpayment/credit balance messaging.

## 9. Suppliers ledger
- Verify totals: purchases, paid, balance owed, suppliers with debt.
- Verify ledger table search, sorting, pagination, empty/loading states, and mobile horizontal scroll.
- Open details modal and record a payment.
- Verify overpayment/credit balance messaging.

## 10. Settings / backup / sync
- Save store name, cashier name, currency code, loss-sale, and low-stock settings.
- Verify invalid currency validation.
- Run local export/backup flows.
- Verify sync queue/conflict status cards still render.

## 11. PWA / offline
- Build production app.
- Confirm favicon appears in the browser tab.
- Install PWA where supported.
- Reload while offline and confirm cached app shell loads.
- Create offline draft sale/purchase and verify sync behavior after reconnect.

## 12. Final commands
- npm run typecheck
- npm run build

## Sprint 4 statement QA addendum

- Open Customers, choose a customer, open Customer statement, change From/To dates, print, and export CSV.
- Open Suppliers, choose a supplier, open Supplier statement, change From/To dates, print, and export CSV.
- Test statements while offline; they should use local ledger data only.
- Verify Arabic mode: statement titles, date fields, debit/credit/balance labels, print layout, and CSV text are readable.
- Verify old records without phone, note, invoice number, or invoice date still open and print safely.

## Step 3 sync hardening QA addendum

- Open the app in two tabs with the same account. Create a sale offline in one tab, reconnect, and confirm the queue is not processed twice.
- Create bill + purchase offline, refresh while offline, reconnect, then confirm both records sync and stock movement deltas are applied once.
- Manually leave a queue row in `syncing` with an old `lastAttemptAt`; after 2+ minutes, run Settings → Device health → Run pending sync and confirm it returns to `pending`/syncs.
- In Settings → Device health, verify these fields render correctly in English and Arabic: purchases, suppliers, expenses, failed/blocked, oldest waiting job, stale syncing jobs, recent sync problems.
- Force a permission-denied sync failure on staging, confirm recent problem row shows the entity/status/error and retry count without crashing the page.

## Step 5 mobile UI QA checklist

- [ ] On Android, open Billing → Scan. Camera opens and soft keyboard does not appear.
- [ ] On iOS/Safari, open Billing → Scan. Camera opens and soft keyboard does not appear.
- [ ] Close the scanner on mobile. Barcode input should not immediately refocus/open keyboard.
- [ ] Add a misc sale item on mobile. After closing the modal, keyboard should not jump back open.
- [ ] Add a product from the dropdown on mobile. Barcode input should not steal focus.
- [ ] Expire/suspend a cashier account, refresh the POS, and confirm Billing shows read-only banner.
- [ ] In read-only Billing, confirm add/scan/product select/customer save/payment/finalize are blocked.
- [ ] In read-only Purchases, confirm add/scan/misc/supplier save/payment/finalize are blocked.
- [ ] Arabic RTL Billing and Purchases: summary cards, buttons, totals, and bottom spacing stay readable.

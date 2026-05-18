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

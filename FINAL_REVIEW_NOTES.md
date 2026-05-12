# Final Review Notes - Offline Mode, Sync, UI, and Calculations

## Scope reviewed

- Offline bill creation, returns, voids, stock movements, settings sequence sync, and queue retry behavior.
- POS billing UI/UX for cashier flow.
- Calculation paths for subtotal, discounts, tax, change, profit, returns, and voids.
- Whether a math/decimal library is needed.

## Changes made in this review

### Offline/online sync

- Added explicit sync requests after bill voids and item returns so queued changes are pushed as soon as the app is online.
- Kept the existing queue model and Firestore idempotency approach. The architecture is good enough for this app if stock movements remain the source of truth for offline sale deltas.
- Preserved the current settings sequence merge behavior so offline bill numbers avoid overwriting full cloud settings.

### Stock and validation

- Added aggregate stock validation for duplicated product lines in a draft. This prevents two lines for the same product from individually passing validation while overselling the combined available stock.

### Calculations

- Added integer-cent helpers in `lib/utils/money.ts` and routed money calculations through them.
- Updated bill profit so discounts reduce profit. Tax is still excluded from profit.
- Updated returns to allocate discount and tax proportionally by returned line subtotal.
- Made fully returned bills reconcile exactly to original bill totals/profit to avoid one-cent drift from proportional allocation.
- Updated POS subtotal display to use centralized calculation helpers instead of raw multiplication.

### UI/UX

- Removed cashier-facing profit from the POS table and summary. Profit is useful in admin/reporting views but distracting and potentially sensitive at checkout.
- Removed the read-only “Expected paid amount” field because it duplicated the total and added mental load.
- Made credit bills default paid amount to `0`, so amount due is clear.
- Kept the core POS layout because the mobile/desktop split is already reasonable.

## Math library recommendation

Do not add a number/math library right now.

For the current product, integer-cent helpers are enough and avoid increasing bundle size or dependency risk. Consider a decimal library later only if the app adds multi-currency accounting, non-two-decimal currencies, more complex tax allocation, or formal accounting reconciliation requirements.

## Validation status

I recreated this artifact after the previous code-interpreter session expired. I could not complete a fresh local dependency install/typecheck in the new session because `npm ci` was terminated by the container timeout before dependencies finished installing.

Recommended local checks before merge:

```bash
npm ci
npm run typecheck
npm run build
```

## Manual QA checklist

1. Create a cash bill while online and confirm bill, bill items, product stock, stock movement, and settings sequence sync.
2. Create a cash bill while offline, reconnect, and confirm the same records sync once with no duplicated stock delta.
3. Create a credit bill and confirm paid amount defaults to 0 and amount due equals total.
4. Add the same product more than once in a draft and confirm combined quantity cannot exceed stock.
5. Return a partial item from a discounted/taxed bill and confirm returned amount/profit are proportional.
6. Fully return a bill and confirm returned amount equals bill total exactly.
7. Void a bill offline, reconnect, and confirm stock restoration syncs.
8. Test two devices creating bills offline/online and confirm `nextBillSequence` uses the max sequence instead of overwriting lower values.

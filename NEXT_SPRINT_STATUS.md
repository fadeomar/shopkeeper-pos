# Next Sprint Status — Production Pilot Readiness

This file tracks what has already been implemented in the current next-sprint sequence and what still needs to be done before a real production pilot.

---

## Step 1 — Release gate, subscription refresh, admin support snapshot

Status: **Done**

Implemented:
- Added `npm run verify` as the main release gate.
- Added automatic logged-in profile refresh when:
  - the app comes online,
  - the browser window gets focus,
  - the tab becomes visible again,
  - the app remains open for 5 minutes.
- Added subscription/trial warning banner for cashier accounts.
- Expanded the admin user detail page support actions:
  - renew 1 month,
  - renew 3 months,
  - suspend,
  - mark contacted,
  - generate password reset link,
  - export support backup JSON.
- Expanded admin support metrics with buy-side and sync-health data:
  - purchases,
  - purchase cost,
  - supplier debt,
  - suppliers,
  - supplier payments,
  - purchase items,
  - cash movements,
  - sync conflicts.

Verified:
- `npm run typecheck` passed after Step 1.

Known note:
- `next build` compiled successfully but previously timed out during page data collection in this sandbox. This still needs CI/staging confirmation with real env vars.

---

## Step 2 — Subscription lifecycle hardening and Firestore rules smoke check

Status: **Done in this package**

Implemented:
- Hardened `firestore.rules` so protected subcollections are not accidentally covered by the generic POS write rule.
  - `settings` keeps its own narrow admin override.
  - `subscriptionRenewals` is now admin append-only and cannot be updated/deleted by cashier/owner self-writes.
- Hardened self-service registration rules:
  - only the exact trial cashier profile shape is accepted,
  - `role` must be `cashier`,
  - `subscriptionStatus` must be `trial`,
  - trial expiry timestamp must be within 15 days,
  - profile keys are allow-listed.
- Added `scripts/verify-firestore-rules.mjs`.
- Added `npm run verify:rules`.
- Updated `npm run verify` to run:
  - typecheck,
  - Firestore rule smoke check,
  - build.
- Changed expired/suspended cashier behavior from full lock screen to **read-only POS access**:
  - cashier can still open the app and inspect inventory, debts, reports, and history,
  - write operations remain blocked by local service checks and Firestore rules,
  - a red read-only subscription banner is shown.

Verified:
- `npm run verify:rules` passed.

Still requires manual/staging validation:
- Firebase emulator test with real authenticated owner/cashier contexts.
- Confirm expired/suspended cashier can view existing data but cannot create/update:
  - bills,
  - purchases,
  - products,
  - customers/suppliers,
  - customer/supplier payments,
  - expenses,
  - cash movements,
  - shifts,
  - settings.

---

## Remaining work before pilot

### P0 — Subscription lifecycle manual QA

Test accounts needed:
- Trial cashier account.
- Active paid cashier account.
- Expired cashier account.
- Suspended cashier account.
- Owner/admin account.

Must pass:
- Trial account can work during trial.
- Expired account can view data but cannot create/edit business records.
- Suspended account can view data but cannot create/edit business records.
- Owner renews 1 month / 3 months and cashier regains write access without logout if profile refresh succeeds.
- Renewal extends from current expiry when still active, or from today when already expired.

### P0 — Firestore emulator validation

Run:

```bash
npm run verify:rules
firebase emulators:start --only firestore
```

Validate:
- Owner can read another user profile.
- Owner can create user profile.
- Owner can renew subscription and append renewal audit row.
- Cashier cannot update role/isActive/subscription fields.
- Cashier cannot write after expiry/suspension.
- Cashier cannot edit/delete `subscriptionRenewals`.

### P0 — Offline/online pilot QA

Must pass:
- Create bill offline, refresh offline, reconnect, no loss/duplicates.
- Create purchase offline, refresh offline, reconnect, stock updates correctly.
- Add customer/supplier offline, use in credit bill/purchase, reconnect, ledger remains correct.
- Two-device sequence test: no duplicate bill or purchase numbers.
- Conflict resolver remains understandable and does not hide blocked jobs.

### P1 — Accounting reconciliation audit

Manually reconcile one full day:

```text
Opening cash
+ cash sales
+ customer payments
- cash purchases
- supplier payments
- expenses
= expected closing cash
```

Dashboard, reports, shift, cash, customers, suppliers, bills, and purchases should all match.

### P1 — Mobile UI QA

Focus on:
- scanner keyboard behavior,
- checkout bar not overlapping bottom nav,
- quantity inputs on mobile and desktop,
- Arabic RTL totals/cards/buttons,
- customer/supplier add button clarity,
- low-stock/out-of-stock → new purchase prefill.

### P2 — Copy polish

Focus on Arabic/English clarity for:
- subscription blocked state,
- sync blocked state,
- conflict resolution,
- empty states,
- admin support warnings.

---

## Step 3 — Offline/online sync pilot hardening

Status: **Done in this package**

Implemented:
- Added a best-effort same-browser multi-tab sync lock:
  - prevents two open tabs from processing the durable sync queue at the same time,
  - expires automatically after 60 seconds so a crashed tab cannot block future sync forever,
  - emits a `shopkeeper:sync-skipped` event when another tab is already running sync.
- Added stale `syncing` job recovery:
  - jobs stuck in `syncing` for more than 2 minutes are re-queued to `pending`,
  - recovery runs before every normal sync pass,
  - recovery is also available from the Settings device-health action.
- Added sync queue health diagnostics service:
  - oldest waiting job,
  - stale syncing job count,
  - recent failed/blocked/conflict jobs with retry count and last error.
- Expanded Settings → Device health:
  - shows buy-side counts: purchases, suppliers, expenses,
  - shows failed/blocked count separately,
  - shows oldest waiting sync job,
  - shows stale syncing jobs,
  - shows recent sync problem rows,
  - adds a **Run pending sync** button separate from the full cloud backup action.

Why this matters:
- The sync service already uses idempotent stock movement deltas for bills/purchases, so this step focuses on operational reliability: avoid duplicate local processing, recover stale jobs, and make support-visible sync state easier to understand.

Still requires manual/staging validation:
- Open two tabs for the same account, create an offline sale, reconnect, and confirm only one tab processes the queue at a time.
- Force-close a tab while a job is `syncing`, reopen after 2+ minutes, and confirm the job is re-queued.
- Confirm Device health shows actionable error details for failed/blocked jobs.

---

## Step 5 — Mobile UI QA polish

Status: **Done in this package**

Implemented:
- POS barcode autofocus is now desktop-only so mobile keyboards do not reopen after scanner close, quick-add, misc item add, or new-sale reset.
- Billing screen now shows a read-only warning banner when the subscription is expired or suspended.
- Billing write actions are disabled in read-only mode:
  - barcode add/scan,
  - product picker,
  - quantity and price edits,
  - misc sale modal,
  - customer manual save,
  - payment method and paid amount,
  - finalize bill.
- Purchase entry screen now shows the same read-only warning behavior.
- Purchase write actions are disabled in read-only mode:
  - product picker/add/scan,
  - quick add missing product,
  - misc purchase modal,
  - supplier manual save,
  - invoice/payment fields,
  - draft line edits,
  - finalize purchase.
- `PaymentMethodControl` now supports a disabled state so payment radios cannot be changed in read-only screens.
- Added Arabic/English copy for billing and purchase read-only states.

Still requires manual phone QA:
- Android/iOS scanner opens without keyboard.
- Closing scanner does not refocus barcode input on mobile.
- POS checkout bar remains reachable above safe areas.
- Purchase page remains usable with the mobile bottom nav.
- Arabic RTL cards and summary fields remain visually clean.

---

## Step 6 — Trial registration diagnostic fix

Status: **Done in this package**

Implemented:
- Trial registration now writes the `/users/{uid}` profile through the same secondary Firebase app/auth session that created the Auth user.
  - This makes the Firestore request authenticated as the new user's uid.
  - It removes the fragile dependency on unauthenticated profile creation.
- Firestore rules were aligned with the safer flow:
  - self-registration must be `request.auth.uid == uid`,
  - the profile shape must still be exactly an active cashier trial account.
- Registration errors now show actionable messages instead of only `Registration failed`:
  - email already used,
  - weak password,
  - invalid email,
  - no internet,
  - Email/Password provider disabled,
  - Firestore profile write denied / rules need deployment,
  - account created but automatic sign-in failed.
- The browser console now logs the actual registration error code/message under:
  - `[auth] trial registration failed`

Manual QA:
- Create a fresh trial account.
- If the UI shows Firestore/rules denial, run `firebase deploy --only firestore:rules` and retry.
- If the UI shows Email/Password provider disabled, enable it in Firebase Console > Authentication > Sign-in method.

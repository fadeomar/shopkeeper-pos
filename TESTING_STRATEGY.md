# Testing Strategy — POS Quality Sprint

This sprint adds an automated testing foundation for the offline-first POS app.
The goal is to turn every high-risk business rule and every user-reported bug into a repeatable test before the next production release.

## Test layers

### 1. Unit tests
Fast tests for pure business rules and utilities.

Current coverage includes:

- money rounding, allocation, and currency formatting
- bill totals, profit, tax, discount, and change calculation
- barcode normalization and validation
- customer/supplier identity normalization
- low-stock threshold logic
- misc item detection for ad-hoc "متفرقات" lines
- settings-driven payment/tax policy
- role permission resolution and fail-closed behavior
- subscription/trial date and access-state rules

### 2. Service integration tests
Dexie-backed business-flow tests that verify records, stock mutations, and sync queue output together.

Current coverage includes:

- `billing-service`
  - cash bill finalization
  - stock decrement
  - stock movement creation
  - bill/settings/stock sync jobs
  - credit bill customer creation/reuse
  - owed amount via `creditAmount`
  - insufficient-stock blocking
  - loss-sale blocking
  - retired mixed-payment blocking
  - misc/متفرقات sale lines with no stock mutation
  - bill item return flow
  - finalized bill void flow
- `purchase-service`
  - cash purchase finalization
  - stock increment
  - stock movement creation
  - purchase/settings/stock sync jobs
  - credit purchase supplier creation/reuse
  - supplier payable via `creditAmount`
  - inactive-product blocking
  - paid-too-low blocking
  - credit-without-supplier blocking
  - retired mixed-payment blocking
  - misc/متفرقات purchase cost lines with no stock mutation
  - purchase item return flow
  - finalized purchase void flow

Additional service coverage added in Chunk 3:

- `customer-ledger-service`
  - canonical customer balance from credit bills + customer payments
  - legacy phone/name payment keys resolving to customer ids
  - voided credit bills ignored in totals
  - payment validation before writes
- `supplier-ledger-service`
  - canonical supplier balance from credit purchases + supplier payments
  - supplier overpayment represented as negative balance
  - voided purchases ignored in totals
  - payment validation before writes
- `shift-service` / cash drawer
  - open-shift creation and duplicate-open blocking
  - require-shift enforcement for cash-affecting writes
  - expected cash from cash sales, customer payments, purchases, supplier payments, manual cash movements, and cash expenses
  - non-cash payments excluded from drawer cash
  - proportional return math through the shared pure summary helper
  - closed-shift locks for bill voids, returns, and explicitly targeted payments
- `sync-queue-service`
  - queue job deduplication
  - dependency-aware entity ordering
  - stuck `syncing` jobs requeued to pending
  - failed/blocked lifecycle counts and manual retry recovery

Additional service/report coverage added in Chunk 4:

- `inventory-service`
  - product creation with initial stock movement
  - cost stripping when the current role cannot edit costs
  - product detail updates that preserve live stock quantity
  - stock adjustment validation and negative-result blocking
  - received stock with optional cost/supplier updates
  - counted-stock correction movements and same-count no-op
- report/Z-report summary utilities
  - custom date ranges with inclusive start and exclusive next-day end
  - expense filtering by `expenseDate` before `createdAt` fallback
  - sales summary net of returns/voids with drawer cash impact
  - purchase summary net of returns/voids with supplier debt delta
  - product/category sales, misc row aggregation, and low-stock sold products
  - customer/supplier party summaries that ignore voided records
  - expense/cash-movement summaries and daily trends
- bills table summary utilities
  - query/date/payment/status/cashier filters
  - paid totals that exclude unpaid credit debt

Additional sync/merge coverage added in Chunk 15 (closing the highest-risk gap — the cloud conflict engine had no coverage):

- `bill-split` (pure)
  - legacy single-method / mixed / credit-deposit split derivation
  - non-finite/negative input clamping
  - `normalizeBillSplit` passthrough vs derive-on-missing
  - proportional `netSplitField` return allocation, voided → 0, never negative
- `date` (pure)
  - `nowIso` against fake timers
  - `localDateKey` local-calendar formatting + zero padding (the local-vs-UTC day-bucket guard)
- `settings-sync-fields` (pure)
  - `finiteSequence` coercion/fallback
  - `mergedSequences` max-merge never regressing a counter
  - `SETTINGS_TRACKED_FIELDS` = business + sequence union (guards the dropped-field bug class)
- `sync-conflict-service` (Dexie-backed)
  - `saveConflict` open-dedup, fingerprint suppression after resolve, reopen on changed cloud/local state
  - `getOpenConflicts` open-only ordering
  - `resolveConflictWithAction` keep_cloud (overwrite local + queue synced) and keep_local (re-queue pending) for product and settings
  - `autoDismissFalseOfflineSaleConflicts` closes false offline bill-stock conflicts and sequence-only settings conflicts, leaves genuine business conflicts open
- `cloud-merge-service` (Firestore reads stubbed; `saveConflict` real)
  - product same-field conflict with quantity → high severity escalation
  - local-newer-than-cloud raises no conflict
  - duplicate-barcode conflict against a different cloud id
  - settings sequence-only drift max-merges with no conflict
  - settings business-field conflict (high) and currency change (critical)
- `cloud-pull-service` `pullCloudChangesBeforePush` (Firestore `getDocs` routed by collection path; Dexie/saveConflict real)
  - id-fallback: a new cloud doc whose body omits its id still lands under the Firestore doc id (the "sign in and see nothing" data-loss regression guard)
  - clean local product overwritten by a newer cloud copy
  - unsynced local edit raises a pull-cloud conflict instead of overwriting
  - settings counter max-merge re-queues a push when the device is ahead
  - remote void/return propagates onto a local bill, but is skipped when a local job is pending
  - append-only history (expenses) insert-if-missing leaves existing rows untouched
- `restore-service` (Firestore reads stubbed; Dexie real)
  - `getRestoreErrorMessage` maps permission-denied/unavailable/unauthenticated + RestoreError passthrough + default
  - `isLocalDbEmpty` true on a fresh DB, false when any business table (not just bills) has a row
  - `fetchSyncMeta` exists/missing/offline-safe paths
  - `pullSettingsFromCloud` no-doc/newer-cloud-with-sequence-merge/pending-job-skip
  - `restoreFromCloud` clears stale local data and replaces it with the cloud backup, bumps the bill sequence past restored bills, regenerates duplicate INV numbers with a restore note, and seeds default settings when the cloud has none

Known follow-up: `npm run test:coverage` needs `@vitest/coverage-v8` added to devDependencies (referenced by vitest.config.ts but not installed) before coverage numbers/thresholds can be enforced in CI.

Additional component coverage added in Chunk 5:

- `QuantityStepper` / `NumberField`
  - multi-digit typing without blur
  - min/max clamp, empty-on-blur recovery, plus/minus buttons
  - mouse wheel does not accidentally mutate quantity
- `PaymentMethodControl`
  - only cash/card/credit options are exposed
  - retired mixed payment is absent from the UI
  - disabled payment methods stay unavailable
  - payment buttons do not submit parent forms
- `SearchableSelect`
  - portal dropdown, text filtering, mouse selection
  - keyboard selection with ArrowDown/Enter
  - disabled options cannot be selected
  - mobile sheet mode avoids autofocus to prevent keyboard pop-up
- `Modal`
  - portal rendering, body scroll lock/restore
  - Escape/backdrop/icon close behavior
  - focus stays trapped inside the dialog
- `BarcodeScannerModal`
  - closed/open states, unsupported camera state, permission-denied state
  - active input is blurred on scanner open so the mobile keyboard closes

Additional service/component coverage added in Chunk 6:

- `expense-service`
  - positive amount validation and rounding
  - payee/note/cashier snapshots trimmed before write
  - sync queue and audit rows requested on create
  - require-shift enforcement applies to cash expenses only
  - active-shift attachment and cash-only drawer totals
  - list filtering by category, payment method, shift, search text, date, and limit
- `cash-movement-service`
  - manual drawer movement amount validation
  - signed amount conventions for cash in/out, owner withdrawals, bank deposits, and drawer corrections
  - sync queue and audit rows requested on create
  - require-shift enforcement for all manual drawer events
  - list filtering and net shift cash movement totals
- `ConfirmDialog`
  - open/closed rendering through `Modal`
  - confirm/cancel callbacks without parent form submission
  - Escape, close icon, and backdrop route to cancel
  - loading disables confirm action
  - tone-to-button-variant mapping
  - initial focus avoids the destructive confirm button

Additional import/export + backup coverage added in Chunk 7:

- product CSV utilities
  - UTF-8 BOM handling, quoted comma/quote/newline cells, Arabic text round-tripping
  - stable product export header order and import-template parseability
- `product-import-service`
  - empty/missing-header preview errors
  - aliased headers (`SKU`, `Product Name`, `Qty`, `Cost`, `Price`, etc.)
  - row-numbered validation errors
  - normalized duplicate barcode detection inside the CSV
  - existing-barcode blocking against IndexedDB
  - successful import with initial stock movements, sync queue jobs, and background sync request
  - race-condition duplicate recheck at import time
  - clean no-op for previews with no valid rows
- local backup utilities
  - backup snapshots now include `auditEvents`, `cashMovements`, and `expenses` in counts + data
  - empty backup plan initializes all current tables
  - JSON download creates and revokes a temporary object URL
- `account-data-service`
  - local data summary includes current operational tables and unsynced-work counts
  - per-account snapshot save/restore preserves settings, sync queue, audit, cash movements, and expenses
  - account switching saves previous UID data, clears runtime data for a new UID, and restores the prior UID safely

Additional component + E2E foundation coverage added in Chunk 8:

- `MoneyInput` / `MoneyInputRHF`
  - localized currency prefix and decimal input mode
  - multi-digit decimal typing without blur
  - comma decimal separators and Arabic-Indic digit parsing
  - invalid alphanumeric buffers do not emit `NaN` or clobber the last valid value while editing
  - empty/invalid blur normalization to `0.00`
  - min/max clamp and two-decimal formatting on blur
  - mouse-wheel protection for focused money fields
  - react-hook-form binding and `onAfterChange` callback coverage
- Playwright E2E foundation
  - public `/guide` smoke test without authentication
  - English → Arabic language switch with `html lang/dir` assertions
  - skipped public-guide offline reload placeholder for the production-build PWA E2E chunk
  - logged-out sign-in screen smoke test
  - sign-up password-confirmation validation before any network call

Additional authenticated E2E harness coverage added in Chunk 9:

- `NEXT_PUBLIC_E2E_AUTH=1` test-auth mode for Playwright only
  - no real Firebase session or network login is required
  - tests opt in by writing `shopkeeper-e2e-auth-v1` to `localStorage` before the app boots
  - mock users are cached in Dexie `authCache` and given an active paid subscription
  - cashier/owner role split can be exercised without production credentials
  - cloud restore/auto-sync work is skipped in E2E mode so tests focus on local offline-first UX
- authenticated cashier shell smoke test
  - dashboard renders under a mocked cashier user
  - POS navigation is available
- demo-data cashier sale-draft smoke test
  - initializes demo products in development
  - opens `/billing`
  - selects a product through the real searchable product picker
  - verifies the sale can reach the review/finalize state
- authenticated owner shell smoke test
  - owner users are redirected away from POS routes into `/admin/users`



Additional authenticated E2E flow coverage added in Chunk 10:

- shared E2E auth helpers
  - `openCashierDashboard(page)` asserts the mocked cashier session reached the POS shell
  - `initializeDemoData(page)` centralizes demo-product setup for user-story tests
- full cash-sale Playwright flow
  - cashier logs in without Firebase
  - initializes demo inventory
  - opens `/billing`
  - selects a real product through `SearchableSelect`
  - confirms mixed payment is absent
  - opens the finalize modal and confirms the sale
  - verifies the saved receipt/success state
- credit customer Playwright flow
  - creates a credit bill
  - manually adds/selects a customer from the customer sheet
  - verifies amount due is visible
  - finalizes the credit sale
  - opens the customer ledger
  - records a customer payment from the detail modal
- purchase/supplier Playwright flow
  - creates a cash purchase for an existing product
  - finalizes the purchase and checks success state
  - creates a credit purchase
  - manually adds/selects a supplier
  - finalizes the payable
  - opens the supplier ledger
  - records a supplier payment from the detail modal
- mobile billing smoke test
  - runs only in the mobile project
  - verifies the cashier can add an item and open the finalize review sheet

Full ledger flows are intentionally desktop-only in Playwright to keep the browser suite stable and fast; the business math remains covered deeply by Vitest service/integration tests. Mobile receives focused smoke coverage around the highest-risk POS checkout path.



Additional production PWA/offline coverage added in Chunk 11:

- `playwright.pwa.config.ts`
  - runs against a production `next build` + `next start` server instead of `next dev`
  - enables `NEXT_PUBLIC_E2E_AUTH=1` and `NEXT_PUBLIC_E2E_SYNC_STUB=1` only for the PWA test build
  - runs serially with one worker because service-worker/offline browser state is intentionally global per context
- E2E sync stub for Playwright only
  - keeps Firebase/network out of offline browser tests
  - after reconnect, marks pending local sync jobs and related local records as synced
  - preserves the production sync path unless the explicit test env flag is baked into the build
- `tests/e2e/pwa-offline.pwa.spec.ts`
  - desktop cashier loads `/billing` from the production service-worker cache while offline
  - offline cashier finalizes a cash sale after an offline reload
  - active sync queue becomes pending while offline
  - reconnecting drains the queue through the E2E sync stub
  - mobile production PWA smoke reloads cached `/billing` offline and reaches the finalize review sheet
- PWA helpers
  - wait for service-worker control
  - assert a specific route exists in Cache Storage
  - query IndexedDB sync queue counts without importing app code into Playwright
  - toggle browser offline/online state and assert the visible network badge

New scripts:

```bash
npm run test:e2e:pwa
npm run qa:release
```

`qa:release` is the long release gate: typecheck + Vitest + build + regular Playwright + production PWA/offline Playwright.



Additional authenticated E2E coverage added in Chunk 12:

- `tests/e2e/authenticated-shift-cash-flows.spec.ts`
  - opens a shift with counted opening cash
  - records a manual cash-in movement linked to the active shift
  - verifies the shift screen reflects manual cash in the expected drawer total
  - closes the shift with matching counted cash
  - verifies the close success state, report modal, and past-shift history row
- `tests/e2e/mobile-route-smoke.spec.ts`
  - mobile-only smoke coverage for Products, Inventory, Customers, Suppliers, Reports, and Settings
  - verifies each route renders its PageHeader and a high-signal page anchor
  - checks that each mobile route avoids horizontal document overflow
- `.github/workflows/release-qa.yml`
  - manual `workflow_dispatch` release gate
  - nightly scheduled release QA run
  - installs Chromium for Playwright
  - runs `npm run qa:release` without slowing normal push CI
  - uploads Playwright reports and test artifacts on failure

New scripts:

```bash
npm run test:e2e:desktop
npm run test:e2e:mobile
```

Additional production/offline + accessibility coverage added in Chunk 13:

- `tests/e2e/pwa-offline-purchase.pwa.spec.ts`
  - desktop cashier loads `/purchases/new` from the production service-worker cache while offline
  - offline cashier finalizes a cash purchase after an offline reload
  - active sync queue becomes pending while offline
  - reconnecting drains the queue through the E2E sync stub
  - mobile production PWA smoke reloads cached `/purchases/new` offline and reaches the finalize review sheet
- `tests/e2e/accessibility-smoke.spec.ts`
  - desktop-only authenticated smoke pass over core cashier pages
  - asserts visible headings and `<main>` landmarks
  - catches duplicate ids, unnamed interactive controls, missing image alt text, and horizontal overflow
  - intentionally uses lightweight browser checks instead of adding a new dependency so the suite stays easy to run
- `.github/workflows/release-qa.yml`
  - release QA is now split into diagnostic jobs instead of one long command
  - separate jobs for static build, unit/integration/component Vitest suites, desktop/mobile/accessibility Playwright, and production PWA offline tests
  - Playwright artifacts are uploaded per suite for easier failure triage

New scripts:

```bash
npm run test:e2e:accessibility
npm run test:e2e:axe
npm run test:e2e:visual
npm run test:e2e:visual:update
npm run test:e2e:pwa:offline-purchase
```


Next E2E chunks should focus on broader production-route smoke coverage:

- visual regression screenshots for high-risk screens now have a dedicated optional Playwright config
- optional CI tuning after Release QA has run a few times on GitHub

### 3. Component tests
Use React Testing Library for high-risk UI components. Current focus is regression coverage for the user-testing bugs already observed; remaining component targets include:

- `ConfirmDialog` follow-ups as new destructive flows are added
- `DataTable` / table filters if user testing finds filtering regressions

### 4. E2E tests
Playwright is now configured with mobile and desktop Chromium projects. Public/logged-out coverage stays in place, and Chunk 9 adds a local-only authenticated harness for cashier/owner user stories.

Current Playwright coverage:

- public guide renders without auth
- guide language switch updates RTL/LTR document attributes
- skipped placeholder documents the production-build offline reload test
- logged-out sign-in shell renders
- sign-up password confirmation validation happens before network calls
- authenticated cashier shell renders without Firebase login
- cashier can seed demo data and build a sale draft from the product picker
- owner routes into the admin user-management shell
- cashier finalizes a cash sale
- cashier creates a credit bill and records a customer payment
- cashier records a cash purchase
- cashier creates a credit purchase and records a supplier payment
- mobile billing smoke reaches the finalize review sheet
- cashier opens/closes a shift and reconciles a manual cash movement
- mobile route smoke covers Products, Inventory, Customers, Suppliers, Reports, and Settings

Next Playwright user stories:

- visual regression screenshots for high-risk screens now have a dedicated optional Playwright config
- optional CI tuning after Release QA has run a few times on GitHub


Additional quality-gate coverage added in Chunk 14:

- `@axe-core/playwright` integration
  - `playwright.accessibility.config.ts` keeps axe separate from the default E2E suite so accessibility failures are easy to triage
  - public login shell and guide pages are scanned
  - authenticated cashier pages are scanned after the test-auth harness seeds demo data
  - the gate currently blocks serious/critical WCAG 2 A/AA violations while allowing lower-impact findings to be triaged without blocking every release
- visual regression foundation
  - `playwright.visual.config.ts` keeps screenshot baselines separate from the default Playwright config
  - high-risk snapshots cover the public guide, cashier dashboard, billing entry state, and mobile product route chrome
  - visual tests are not part of normal `npm run test:e2e`; run `npm run test:e2e:visual:update` once to create/refresh baselines, commit the generated snapshots, then use `npm run test:e2e:visual` for regression checks
- Release QA workflow tuning
  - accessibility now has both lightweight smoke checks and axe checks
  - visual regression is available as an optional manual workflow input (`run_visual`) so nightly/release runs are not blocked before baselines are intentionally committed

## Commands

```bash
npm run test
npm run test:unit
npm run test:integration
npm run test:services
npm run test:watch
npm run test:coverage
npm run test:e2e
npm run test:e2e:desktop
npm run test:e2e:mobile
npm run test:e2e:ui
npm run test:e2e:accessibility
npm run test:e2e:axe
npm run test:e2e:visual
npm run test:e2e:visual:update
npm run test:e2e:pwa
npm run test:e2e:pwa:offline-purchase
npm run qa
npm run qa:full
npm run qa:release
```

`npm run qa` runs typecheck, unit/integration/component tests, and production build. `npm run qa:full` adds regular Playwright E2E on top. `npm run qa:release` is the longest gate and also runs production-build PWA/offline E2E, so use it for release candidates rather than every small local edit.

## Bug-to-test rule

From now on, every confirmed user-testing bug should get a regression test before the fix is considered done. Examples:

- scanner modal opens keyboard on mobile → component test around scanner/input focus
- quantity input blurs after the first digit → component test around multi-digit typing
- credit bill without customer → service test
- stock mismatch after void/return → service integration test
- Arabic translation key appears in UI → component or E2E text assertion

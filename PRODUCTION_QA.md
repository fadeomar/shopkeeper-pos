# Production QA — steps for the human (things Claude can't run)

These three can only be done by you in a real browser / Firebase / CI. Do them
before shipping to real users. Everything else (code) is being handled in the
codebase; see REFACTOR_NOTES.md.

---

## A. Real offline → online multi-device sync test  ⚠️ highest priority

Why: the sequence-safety and settings-field sync fixes are verified only by code
reasoning. This is the one test that proves they actually work across devices.

### Setup
1. Build + serve the offline PWA (the SW is disabled in plain `npm run dev`):
   ```bash
   npm run preview:offline      # production build + SW
   # or: npm run dev:offline
   ```
2. Open it in Browser A, sign in with a real Firebase account, and **wait for the
   sync badge to read "Synced"** (cache ready).

### Single-device offline durability
3. Create a product (online).
4. Go offline (DevTools → Network → Offline, or disable Wi-Fi).
5. Create: a bill, a purchase, a customer payment, a supplier payment, a cash
   movement, and an expense.
6. **Refresh the page while offline** → all data still present?
7. **Close and reopen the installed PWA while offline** → still present?

### Reconnect
8. Go back online. Confirm the queue moves **pending → syncing → synced WITHOUT a
   manual reload** (the SyncProvider should pick it up on the `online` event).

### Multi-device convergence (the important part)
9. On Browser B (or a second device), sign in with the **same** account.
10. Confirm products, stock, bills, purchases, balances, and reports match.
11. **Sequence check:** create a bill AND a purchase offline on *each* device, then
    bring both online. Confirm: no duplicate bill numbers, no duplicate PO
    numbers, and `nextBillSequence`/`nextPurchaseSequence` only moved *forward*.
12. **Settings check:** on Browser A change `taxMode` / `enableCard` /
    `defaultDiscountLimit` / `requireShift` / a role permission. On Browser B
    (offline first, then online) confirm those changes survive and aren't
    silently overwritten by B's older settings.

If 11 or 12 fail, capture the two devices' `settings` docs + sync queue and report.

---

## B. Firestore rules validation (owner/admin fix)

Why: `firestore.rules` now treats role `owner` (not `admin`) as admin-capable.
Validate before deploy.

### Option 1 — emulator (preferred)
```bash
firebase emulators:start --only firestore
```
Then, signed in as a user with `role: "owner"`, confirm these succeed:
- read another user's `/users/{uid}` profile
- create a new user profile (admin-created path)
- the admin settings-support write (only the narrow allow-list fields)
And confirm a `role: "cashier"` user is **denied** all of the above.

### Option 2 — staging deploy
```bash
firebase deploy --only firestore:rules    # to a staging project
```
Then exercise the admin pages as an `owner` account and confirm no
permission-denied errors in the console.

---

## C. CI sanity (an earlier reviewer saw a build "hang")

It builds clean locally here, so the hang is likely environmental. Confirm:
```bash
npm ci --no-audit --no-fund
npm run typecheck
npm run build
```
If `build` stalls at "Collecting page data / Generating static pages", the most
likely cause is **Firebase being called during prerender with missing/placeholder
env vars** (a network call that never resolves). Check that all
`NEXT_PUBLIC_FIREBASE_*` vars are set in the CI environment, or that no page does
Firebase work at module scope / in `generateMetadata`.

---

## Done-before-production checklist
- [ ] A. Offline→online multi-device sync test passes (incl. sequence + settings)
- [ ] B. Firestore rules validated (owner can admin; cashier can't)
- [ ] C. `npm ci && typecheck && build` green in CI
- [ ] Full mobile UI pass in English **and** Arabic (RTL)

## Sprint 4 production QA focus

Customer and supplier statements must be tested with: all-time period, custom period, no matching rows, partial payments, cash/card paid at bill or purchase time, and later debt payments. CSV exports should match the filtered statement rows shown in the UI and print output should hide app navigation.

## Step 3 production pilot sync checks

- Same-browser multi-tab: keep two tabs open on the same account and reconnect after offline work. Only one sync run should actively process the local queue; the second tab may refresh health but should not duplicate work.
- Stale syncing recovery: a queue row stuck in `syncing` for more than 2 minutes should be automatically returned to `pending` on the next sync run.
- Support visibility: Settings → Device health should show enough details for a support call: local counts, waiting jobs, failed/blocked jobs, oldest waiting job, and recent sync errors.
- Full backup should still refuse to run when active queue/conflicts exist; use **Run pending sync** first, then run **Sync Now** only after the queue is clean.

## Step 5 — mobile and read-only pilot QA

Use a real phone before pilot rollout:

1. Scanner keyboard regression
   - Billing scanner opens without soft keyboard.
   - Scanner close does not reopen barcode input keyboard on mobile.
   - Desktop barcode scan loop still focuses the barcode field after product add.

2. Read-only subscription regression
   - Expired/suspended cashier can view data.
   - Expired/suspended cashier cannot create bills or purchases from the UI.
   - Firestore rules and service checks remain the final enforcement layer.

3. Purchase entry mobile regression
   - Purchase draft cards are editable for active users.
   - Purchase draft cards are disabled for read-only users.
   - Mobile bottom navigation does not hide the final action area.

# Shopkeeper POS - Offline First Supermarket / POS / Inventory App

A production-minded frontend-first supermarket and inventory management starter built with Next.js App Router, TypeScript, IndexedDB, and a custom PWA setup.

## Why this architecture

- **IndexedDB is the source of truth** via Dexie.
- **Products are mutable live inventory.**
- **Bills and bill items are immutable snapshots.**
- **Stock movements create an audit trail** for every stock-affecting action.
- **No backend dependency** for version 1.
- **JSON is reserved for future manual backup/import/export**, not live storage.

## Main business guarantees

1. Product edits never rewrite historical bills.
2. Finalized bills cannot be edited.
3. Bill items store product snapshot fields at sale time.
4. Live stock is reduced only through the billing workflow or adjustments.
5. Profit calculations come from saved snapshot prices, not current catalog data.

## Tech stack

- Next.js App Router
- TypeScript
- Dexie + IndexedDB
- React Hook Form + Zod
- Custom PWA manifest + service worker registration

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## PWA notes

- Manifest is served from `app/manifest.ts`.
- Service worker file is in `public/sw.js`.
- Registration happens client-side in `components/pwa/sw-register.tsx`.
- The app is designed so core UX keeps working offline after first load.

## Seed data

Use the **Initialize Demo Data** action on the dashboard to populate products, bills, bill items, settings, and stock movement history for testing.

## Current structure

- `app/` routes and app shell
- `components/` shared UI and PWA helpers
- `features/products/` product forms, table, validation
- `features/bills/` POS flow, bill history, detail screen, validation
- `features/inventory/` stock adjustment UI
- `lib/db/` Dexie database, repositories, seed helpers
- `lib/services/` billing and inventory business logic
- `lib/utils/` helpers for ids, dates, money, backup planning
- `types/` core domain models

## Future-ready areas intentionally prepared

- JSON backup/export/import orchestration
- barcode scanner input hooks
- returns / refunds
- customers / suppliers
- dashboard analytics
- server sync / multi-device sync

## Important implementation decision

The `createFinalizedBill()` service is the key business boundary. It:

1. Validates stock from live products.
2. Creates immutable bill item snapshots.
3. Calculates totals and profit.
4. Deducts live stock.
5. Writes stock movement records.
6. Saves the finalized bill in one Dexie transaction.

That service should remain the only place that final sale writes happen.


## v2 improvements included

- Bill finalization now re-reads and validates live stock inside a single IndexedDB transaction before writing immutable bill records.
- Product edit no longer changes live stock silently. Stock changes must go through stock adjustment so the audit trail stays complete.
- POS draft is persisted locally in browser storage to reduce accidental data loss on refresh.
- Browser prompt and confirm dialogs were replaced with in-app modal flows for stock adjustment and bill finalization.
- Added a settings page for store-level defaults and validation behavior.
- PWA service worker caching was expanded and the app now shows visible offline readiness status.

## Core accounting rules

- Products are mutable live inventory records.
- Bills and bill items are immutable historical records.
- Bill details must always render from bill snapshots, never from current product fields.
- Every stock quantity change should have a stock movement entry.
- Product quantity editing is intentionally separated from product detail editing.

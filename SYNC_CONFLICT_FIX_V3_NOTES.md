# Sync Conflict Fix v3

This build keeps the offline/PWA fixes from v2 and fixes the false product conflict shown after reconnecting with an offline bill.

## Main changes

- Reconnect now drains the incremental local sync queue first instead of running a full cloud backup immediately.
- Offline bill jobs are processed before product/settings pull checks, so sale-driven stock decreases are not mistaken for manual product overwrites.
- Product/settings `syncedAt` timestamps are preserved when existing records become pending, giving conflict detection the correct base version.
- Bill sequence changes merge with `max(local, cloud)` instead of creating settings conflicts or moving bill numbers backwards.
- The Settings Sync Now button now retries/drains queued offline work first, then runs the full cloud backup only when the queue is clean.
- Restoring from cloud clears old local sync conflicts and queue rows.
- Identical already-resolved conflicts are not reopened immediately on the next sync pass.
- False conflicts left open by older builds can be auto-ignored when they exactly match pending offline bill movements.

## Test path

1. Start with `npm run preview:offline` and expose the same server with Cloudflare.
2. Login online and restore cloud data.
3. Wait for the app/offline cache to be ready, then visit Sell, Bills, Products, and Settings once.
4. Turn off Wi-Fi/mobile data.
5. Create one bill with two products.
6. Confirm the pending sync count increases.
7. Turn the network back on.
8. Expected: the bill syncs without a Product Conflict for those sold products.
9. Open Settings and press Sync Now.
10. Expected: no repeat conflict modal; pending sync reaches 0 after the queue drains.

If old conflicts from previous test builds are already open, resolve or restore fresh once before judging this fix. New cloud restores now clear stale local conflict rows.

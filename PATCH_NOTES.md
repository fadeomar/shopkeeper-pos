# Patch notes: logout visibility + safer cloud/local sync foundation

## What changed in this patch

### Visible sign out controls
- Added a visible **Sign out** action to the mobile cashier header.
- Added a visible **Sign out** action to the mobile admin header.
- Kept the existing desktop sign out action in the left sidebar.
- Added compact sync status support so the mobile header can show sync state without taking too much space.

### Safer logout UX
- Sign out still opens the safety modal before ending the Firebase session.
- The modal explains whether the browser is offline, has pending changes, or has conflicts.
- Local browser data is kept per account instead of being deleted during logout.

### Pull-before-push sync behavior
- Added `pullCloudChangesBeforePush(uid)`.
- Before pushing local queued changes, the sync provider now pulls cloud data first.
- This protects the old-browser case:
  - Browser A has older data.
  - Browser B changes cloud data.
  - Browser A comes back later.
  - Browser A pulls newer cloud data before pushing local changes.

### Conflict detection foundation
- Added cloud conflict checks for products and settings before push.
- Detects same-field product conflicts.
- Detects duplicate product barcode conflicts.
- Detects settings conflicts.
- Marks conflicted sync queue jobs as `conflict` and pauses sync until the user reviews them.

### Conflict resolver actions
- `Keep cloud` now applies the cloud version locally for products/settings and marks the sync job as synced.
- `Keep this device` marks the local record as pending again and requests another sync.
- `Mark reviewed` keeps the local version pending and requests another sync.

## Important behavior notes

- `Start empty on this device` still does not delete cloud data.
- If the user later creates local data and syncs, the app pulls cloud data first and creates conflicts when risky overwrites are detected.
- Append-only records such as bills, bill items, stock movements, and customer payments are pulled if they do not already exist locally.
- Product and settings conflicts are handled more strictly because they are editable records and can overwrite each other.

## Testing performed here

- Verified the updated project zip structure with `unzip -t` after packaging.
- Attempted `npm run typecheck`, but this environment could not complete a clean dependency install. `npm ci` / `npm install` timed out and left `node_modules` incomplete, so TypeScript reported missing Next/Firebase/Dexie declarations. The project should be checked locally with a clean install.

Recommended local checks:

```bash
npm ci
npm run typecheck
npm run build
```

## Recommended next step

Implement a full conflict detail UI instead of JSON previews:
- field-by-field comparison for products/settings,
- merge manually form,
- duplicate product merge flow,
- manager-review behavior for critical sale/payment conflicts.

After that, add version/baseVersion metadata to each entity and sync queue operation so conflict detection does not depend mainly on `syncedAt` timestamps.

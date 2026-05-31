// Stamps the package.json version into public/sw.js CACHE_VERSION so the
// service-worker cache name can never drift from the app version. Runs
// automatically before `next build` via the npm "prebuild" script.
//
// The same package.json `version` already feeds NEXT_PUBLIC_APP_VERSION
// (see next.config.ts), so bumping package.json on a release is the single
// knob that updates both the visible app version and the SW cache name —
// which triggers the browser to install a fresh worker and purge stale caches.
//
// Idempotent: if the literal already matches, the file is left untouched so
// repeat builds produce no spurious diff.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const swPath = join(root, "public", "sw.js");

const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));
if (!version || typeof version !== "string") {
  console.error("[stamp-sw-version] package.json has no valid version string.");
  process.exit(1);
}

const source = readFileSync(swPath, "utf8");

// Match the marked line:  const CACHE_VERSION = "x.y.z"; // @sw-version ...
const VERSION_RE =
  /(const CACHE_VERSION = ")[^"]*(";\s*\/\/ @sw-version)/;

if (!VERSION_RE.test(source)) {
  console.error(
    "[stamp-sw-version] Could not find the '@sw-version' CACHE_VERSION marker in public/sw.js.",
  );
  process.exit(1);
}

const next = source.replace(VERSION_RE, `$1${version}$2`);

if (next === source) {
  console.log(`[stamp-sw-version] CACHE_VERSION already at ${version}.`);
} else {
  writeFileSync(swPath, next);
  console.log(`[stamp-sw-version] CACHE_VERSION set to ${version}.`);
}

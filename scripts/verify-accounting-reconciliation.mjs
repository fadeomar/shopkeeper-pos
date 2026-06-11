#!/usr/bin/env node
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`✗ ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${message}`);
  }
}

const util = read('features/reports/utils/accounting-reconciliation.ts');
const reports = read('features/reports/components/reports-workspace.tsx');
const z = read('features/reports/components/z-report.tsx');
const en = read('lib/i18n/en.ts');
const ar = read('lib/i18n/ar.ts');
const pkg = JSON.parse(read('package.json'));

assert(util.includes('export function buildCashDrawerReconciliation'), 'shared accounting reconciliation utility exists');
assert(util.includes('openingCash + moneyIn - moneyOut'), 'drawer formula is centralized as opening + money in - money out');
assert(util.includes("drawer_records_without_shift"), 'missing-shift drawer warning is implemented');
assert(util.includes("split_mismatch"), 'payment split mismatch warning is implemented');
assert(reports.includes('buildCashDrawerReconciliation'), 'Reports page uses shared reconciliation');
assert(z.includes('buildCashDrawerReconciliation'), 'Z report uses shared reconciliation');
assert(reports.includes('reconciliationTitle') && z.includes('reconciliationIssuesTitle'), 'UI exposes reconciliation summary and warnings');
assert(en.includes('reconciliationTitle') && ar.includes('reconciliationTitle'), 'English and Arabic reconciliation translations exist');
assert(pkg.scripts?.verify?.includes('verify:accounting'), 'npm run verify includes accounting smoke checks');

if (process.exitCode) process.exit(process.exitCode);

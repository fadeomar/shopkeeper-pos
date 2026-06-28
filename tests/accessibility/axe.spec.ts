import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { initializeDemoData, loginAsOwner } from '../e2e/helpers/auth';

type AxePage = {
  path: string;
  name: string;
  heading: RegExp;
  authenticated?: boolean;
};

const PUBLIC_PAGES: AxePage[] = [
  { path: '/', name: 'public login shell', heading: /welcome|sign in|my shop|asas pos/i },
  { path: '/guide', name: 'public guide', heading: /run your shop|guide|welcome/i },
];

const CASHIER_PAGES: AxePage[] = [
  { path: '/', name: 'cashier dashboard', heading: /my shop|dashboard/i, authenticated: true },
  { path: '/billing', name: 'billing', heading: /create bill/i, authenticated: true },
  { path: '/products', name: 'products', heading: /^products$/i, authenticated: true },
  { path: '/inventory', name: 'inventory', heading: /^inventory$/i, authenticated: true },
  { path: '/customers', name: 'customers', heading: /^customers$/i, authenticated: true },
  { path: '/reports', name: 'reports', heading: /^reports$/i, authenticated: true },
  { path: '/settings', name: 'settings', heading: /^settings$/i, authenticated: true },
];

function formatAxeViolations(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 3)
        .map((node) => `  - ${node.target.join(' ')}: ${node.failureSummary?.replace(/\s+/g, ' ') ?? 'No summary'}`)
        .join('\n');
      return `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}\n${nodes}`;
    })
    .join('\n\n');
}

async function expectNoCriticalAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('[data-testid="toast-viewport"]')
    .analyze();

  const blockingViolations = results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
  expect(blockingViolations, formatAxeViolations(blockingViolations)).toEqual([]);
}

test.describe('axe accessibility checks', () => {
  for (const axePage of PUBLIC_PAGES) {
    test(`${axePage.name} has no serious or critical axe violations`, async ({ page }) => {
      await page.goto(axePage.path);
      await expect(page.getByRole('heading', { name: axePage.heading }).first()).toBeVisible();
      await expectNoCriticalAxeViolations(page);
    });
  }

  test.describe('authenticated cashier pages', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsOwner(page);
      await initializeDemoData(page);
    });

    for (const axePage of CASHIER_PAGES) {
      test(`${axePage.name} has no serious or critical axe violations`, async ({ page }) => {
        await page.goto(axePage.path);
        await expect(page.getByRole('heading', { name: axePage.heading }).first()).toBeVisible();
        await expectNoCriticalAxeViolations(page);
      });
    }
  });
});

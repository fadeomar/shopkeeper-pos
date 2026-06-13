import { expect, test } from '@playwright/test';
import { initializeDemoData, loginAsCashier } from './helpers/auth';

const MOBILE_ROUTES: Array<{ path: string; heading: RegExp; anchor: RegExp }> = [
  { path: '/products', heading: /^Products$/i, anchor: /add product|product import/i },
  { path: '/inventory', heading: /^Inventory$/i, anchor: /stock value|recent stock movements|low stock/i },
  { path: '/customers', heading: /^Customers$/i, anchor: /customer ledger|add customer/i },
  { path: '/suppliers', heading: /suppliers & payables/i, anchor: /supplier ledger|add supplier/i },
  { path: '/reports', heading: /^Reports$/i, anchor: /total sales|payment breakdown/i },
  { path: '/settings', heading: /^Settings$/i, anchor: /language|payment methods|device health/i },
];

async function expectNoHorizontalPageOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return Math.ceil(doc.scrollWidth - doc.clientWidth);
  });
  expect(overflow).toBeLessThanOrEqual(4);
}

test.describe('mobile authenticated route smoke', () => {
  test('cashier can open the core mobile pages without layout overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'mobile route smoke runs only on the mobile project');

    await loginAsCashier(page);
    await initializeDemoData(page);

    for (const route of MOBILE_ROUTES) {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { name: route.heading })).toBeVisible();
      await expect(page.getByText(route.anchor).first()).toBeVisible();
      await expect(page.getByRole('main')).toBeVisible();
      await expectNoHorizontalPageOverflow(page);
    }
  });
});

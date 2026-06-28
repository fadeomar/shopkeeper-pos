import { expect, test, type Locator, type Page } from '@playwright/test';
import { initializeDemoData, loginAsOwner } from '../e2e/helpers/auth';

async function stabilizePage(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
      }
      [data-testid="toast-viewport"], [role="status"], [aria-live] {
        visibility: hidden !important;
      }
    `,
  });
  await page.evaluate(() => document.fonts?.ready.then(() => true).catch(() => true) ?? true);
}

function dynamicMasks(page: Page): Locator[] {
  return [
    page.locator('time'),
    page.locator('[datetime]'),
    page.locator('[data-testid="sync-status"]'),
    page.locator('[data-testid="clock"]'),
    page.locator('[aria-live]'),
  ];
}

async function expectStableScreenshot(page: Page, name: string) {
  await stabilizePage(page);
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    mask: dynamicMasks(page),
  });
}

test.describe('visual regression baselines', () => {
  test('public guide desktop/mobile remains visually stable', async ({ page }, testInfo) => {
    await page.goto('/guide');
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expectStableScreenshot(page, `public-guide-${testInfo.project.name}.png`);
  });

  test('cashier dashboard desktop/mobile remains visually stable', async ({ page }, testInfo) => {
    await loginAsOwner(page, { uid: `visual-${testInfo.project.name}`, name: 'Visual Cashier', email: `visual-${testInfo.project.name}@example.test` });
    await initializeDemoData(page);
    await page.goto('/');
    await expect(page.getByRole('main')).toBeVisible();
    await expectStableScreenshot(page, `cashier-dashboard-${testInfo.project.name}.png`);
  });

  test('billing entry state desktop/mobile remains visually stable', async ({ page }, testInfo) => {
    await loginAsOwner(page, { uid: `visual-billing-${testInfo.project.name}`, name: 'Visual Cashier', email: `visual-billing-${testInfo.project.name}@example.test` });
    await initializeDemoData(page);
    await page.goto('/billing');
    await expect(page.getByRole('heading', { name: /create bill/i })).toBeVisible();
    await expectStableScreenshot(page, `billing-entry-${testInfo.project.name}.png`);
  });

  test('mobile core route chrome remains visually stable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'mobile route chrome snapshot runs only on mobile');

    await loginAsOwner(page, { uid: 'visual-mobile-routes', name: 'Visual Cashier', email: 'visual-mobile@example.test' });
    await initializeDemoData(page);
    await page.goto('/products');
    await expect(page.getByRole('heading', { name: /^products$/i })).toBeVisible();
    await expectStableScreenshot(page, 'products-mobile-chrome.png');
  });
});

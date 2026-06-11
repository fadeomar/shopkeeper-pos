import { expect, test } from '@playwright/test';

test.describe('public guide smoke', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test('renders logged-out guide without requiring auth or IndexedDB data', async ({ page }) => {
    await page.goto('/guide');

    await expect(page).toHaveTitle(/Guide.*Asas POS/i);
    await expect(page.getByRole('heading', { name: /run your shop/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /^sign in$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/works offline/i)).toBeVisible();
  });

  test('switches guide locale to Arabic and updates html dir for RTL', async ({ page }) => {
    await page.goto('/guide');
    await page.getByRole('button', { name: 'عربي' }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: /أدِر متجرك/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /تسجيل الدخول/i }).first()).toBeVisible();
  });

  test.skip('keeps public guide usable while offline after first load once PWA E2E runs against production build', async ({ page, context }) => {
    // TODO: enable in the authenticated/offline E2E chunk with `next build && next start`
    // and NEXT_PUBLIC_ENABLE_OFFLINE_SW=1. Next dev does not reliably serve cached
    // application chunks after Playwright switches the browser context offline.
    await page.goto('/guide');
    await expect(page.getByRole('heading', { name: /run your shop/i })).toBeVisible();

    await context.setOffline(true);
    await page.reload();

    await expect(page.getByRole('heading', { name: /run your shop/i })).toBeVisible();
    await expect(page.getByText(/your sales are safe/i)).toBeVisible();
  });
});

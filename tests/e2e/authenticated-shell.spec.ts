import { expect, test } from '@playwright/test';
import { loginAsCashier } from './helpers/auth';

test.describe('authenticated cashier shell', () => {
  test('lands on the dashboard without using a real Firebase session', async ({ page }, testInfo) => {
    await loginAsCashier(page);
    await page.goto('/');

    await expect(page.getByRole('link', { name: /create.*bill/i })).toBeVisible();
    await expect(page.getByText(/live products/i)).toBeVisible();

    if (testInfo.project.name === 'desktop-chrome') {
      // The cashier name and the "New Bill" sidebar nav link only render in the
      // desktop sidebar; mobile uses a bottom nav ("Sell") and a "More" menu.
      await expect(page.getByText(/e2e cashier/i)).toBeVisible();
      await expect(page.getByRole('link', { name: /^new bill$/i })).toBeVisible();
    }
  });

  test('can seed demo data and build a cashier sale draft', async ({ page }) => {
    await loginAsCashier(page);
    await page.goto('/');

    await page.getByRole('button', { name: /initialize demo data/i }).click();
    await expect(page.getByText(/demo data initialized|demo data already exists/i)).toBeVisible();

    await page.getByRole('link', { name: /create.*bill/i }).click();
    await expect(page).toHaveURL(/\/billing$/);
    await expect(page.getByRole('heading', { name: /create bill/i })).toBeVisible();

    await page.getByRole('button', { name: /select product/i }).click();
    await page.getByRole('combobox', { name: /search by name/i }).fill('Milk');
    await page.getByRole('option', { name: /Milk 1L/i }).click();

    await expect(page.getByText('Milk 1L').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /review & finalize/i }).last()).toBeEnabled();
  });
});

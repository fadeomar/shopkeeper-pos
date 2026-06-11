import { expect, test } from '@playwright/test';

test.describe('logged-out auth shell smoke', () => {
  test('shows the sign-in form and guide link for unauthenticated users', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /Asas POS/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /learn how it works/i })).toHaveAttribute('href', '/guide');
  });

  test('validates sign-up password confirmation before calling the network', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /try the app/i }).click();

    await page.getByLabel(/full name/i).fill('Test Cashier');
    await page.getByLabel(/^email$/i).fill('cashier@example.test');
    await page.getByLabel(/^password$/i).fill('secret123');
    await page.getByLabel(/confirm password/i).fill('different123');
    await page.getByRole('button', { name: /create.*trial/i }).click();

    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });
});

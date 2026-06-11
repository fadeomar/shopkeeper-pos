import { expect, test } from '@playwright/test';
import { loginAsOwner } from './helpers/auth';

test.describe('authenticated owner shell', () => {
  test('routes owner users to the admin user-management area', async ({ page }) => {
    await loginAsOwner(page);
    await page.goto('/');

    await expect(page).toHaveURL(/\/admin\/users/);
    await expect(page.getByText(/admin/i).first()).toBeVisible();
    await expect(page.getByText(/e2e owner/i)).toBeVisible();
  });
});

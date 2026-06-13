import { expect, test } from '@playwright/test';
import { loginAsOwner } from './helpers/auth';

test.describe('authenticated owner shell', () => {
  test('routes owner users to the admin user-management area', async ({ page }, testInfo) => {
    await loginAsOwner(page);
    await page.goto('/');

    await expect(page).toHaveURL(/\/admin\/users/);
    await expect(page.getByText(/admin/i).filter({ visible: true }).first()).toBeVisible();

    if (testInfo.project.name === 'desktop-chrome') {
      // The owner's name only renders in the desktop sidebar (hidden on mobile,
      // which shows just the "Admin" badge).
      await expect(page.getByText(/e2e owner/i).filter({ visible: true }).first()).toBeVisible();
    }
  });
});

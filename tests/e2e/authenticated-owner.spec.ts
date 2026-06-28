import { expect, test } from '@playwright/test';
import { loginAs, loginAsOwner } from './helpers/auth';

test.describe('authenticated admin shell', () => {
  test('routes administration users to the admin user-management area', async ({ page }, testInfo) => {
    await loginAs(page, 'administration', { name: 'E2E Admin' });
    await page.goto('/');

    await expect(page).toHaveURL(/\/admin\/users/);
    await expect(page.getByText(/admin/i).filter({ visible: true }).first()).toBeVisible();

    if (testInfo.project.name === 'desktop-chrome') {
      // The admin's name only renders in the desktop sidebar (hidden on mobile,
      // which shows just the "Admin" badge).
      await expect(page.getByText(/e2e admin/i).filter({ visible: true }).first()).toBeVisible();
    }
  });

  test('keeps owner users on the POS shell rather than the admin area', async ({ page }) => {
    // After the multi-user permissions rework, "administration" is the only role
    // routed to /admin/users. Owners are full-permission POS users and stay on
    // the cashier shell.
    await loginAsOwner(page);
    await page.goto('/');

    await expect(page).not.toHaveURL(/\/admin\/users/);
    await expect(page.getByRole('link', { name: /create.*bill/i })).toBeVisible();
  });
});

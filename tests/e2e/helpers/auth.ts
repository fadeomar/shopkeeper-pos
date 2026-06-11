import { expect, type Page } from '@playwright/test';
import type { UserRole } from '@/types/domain';

export const E2E_AUTH_STORAGE_KEY = 'shopkeeper-e2e-auth-v1';

export async function loginAs(
  page: Page,
  role: UserRole = 'cashier',
  options: { uid?: string; name?: string; email?: string } = {},
): Promise<void> {
  const uid = options.uid ?? `e2e-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const name = options.name ?? (role === 'owner' ? 'E2E Owner' : 'E2E Cashier');
  const email = options.email ?? `${uid}@example.test`;

  await page.addInitScript(
    ({ key, payload }) => {
      window.localStorage.setItem(key, JSON.stringify(payload));
      window.localStorage.setItem('shopkeeper-pos-locale', 'en');
    },
    { key: E2E_AUTH_STORAGE_KEY, payload: { uid, role, name, email } },
  );
}

export async function loginAsCashier(page: Page, options?: { uid?: string; name?: string; email?: string }): Promise<void> {
  await loginAs(page, 'cashier', options);
}

export async function loginAsOwner(page: Page, options?: { uid?: string; name?: string; email?: string }): Promise<void> {
  await loginAs(page, 'owner', options);
}

export async function openCashierDashboard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /create bill/i })).toBeVisible();
}

export async function initializeDemoData(page: Page): Promise<void> {
  await openCashierDashboard(page);
  const initDemo = page.getByRole('button', { name: /initialize demo data/i });
  await expect(initDemo).toBeVisible();
  await initDemo.click();
  await expect(page.getByText(/demo data initialized|demo data already exists/i)).toBeVisible();
}

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PWA_PORT ?? process.env.E2E_PORT ?? 3200);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

const e2eEnv = 'NEXT_PUBLIC_E2E_AUTH=1 NEXT_PUBLIC_E2E_SYNC_STUB=1 NEXT_PUBLIC_ENABLE_OFFLINE_SW=1';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.pwa\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'en-US',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `cross-env ${e2eEnv} npm run build && cross-env ${e2eEnv} npm run start -- -H 127.0.0.1 -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 240_000,
      },
  projects: [
    {
      name: 'pwa-desktop-chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'pwa-mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
});

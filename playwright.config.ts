import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: /.*\.pwa\.spec\.ts/,
  // The webServer is `next dev`, which compiles each route on first hit. Under
  // parallel load those first compilations are slow, so timeouts are generous
  // and workers are capped to keep the single dev server from thrashing.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 2,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 390, height: 844 },
    locale: 'en-US',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `cross-env NEXT_PUBLIC_E2E_AUTH=1 npm run dev -- --hostname 127.0.0.1 --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
  ],
});

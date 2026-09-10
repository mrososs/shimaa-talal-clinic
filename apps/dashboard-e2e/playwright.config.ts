import { defineConfig, devices } from '@playwright/test';

const apiUrl = process.env['E2E_API_URL'] ?? 'http://localhost:3000/api/v1';
const dashboardUrl =
  process.env['E2E_DASHBOARD_URL'] ?? 'http://localhost:4203';
const mobileUrl = process.env['E2E_MOBILE_URL'] ?? 'http://localhost:4202';

export default defineConfig({
  testDir: './src',
  globalSetup: './src/global-setup.ts',
  globalTeardown: './src/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: '../../tmp/playwright/dashboard',
  reporter: process.env['CI']
    ? [['line'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  metadata: { apiUrl, dashboardUrl, mobileUrl },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: dashboardUrl,
    channel: 'chrome',
    locale: 'ar-EG',
    timezoneId: 'Africa/Cairo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm dev:api',
      url: `${apiUrl}/health`,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'pnpm dev:mobile',
      url: mobileUrl,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'pnpm dev:dashboard',
      url: dashboardUrl,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
  ],
});

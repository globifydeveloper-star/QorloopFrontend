import { defineConfig } from '@playwright/test';

/**
 * Browser tests run against a REAL backend (QorLoopBackend) and database; nothing is mocked.
 * See e2e/README.md for how to start it. E2E_BASE_URL must be a <store>.localhost URL so the backend
 * resolves the tenant from the Host header exactly as it does in production.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://dohafresh.localhost:3000',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

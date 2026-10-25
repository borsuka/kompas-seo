import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/**
 * E2E runs against the full stack (docker services + api + worker + web).
 * Locally: start `pnpm dev`, then `pnpm test:e2e` (servers are reused).
 * CI: builds first, then the webServer entries below start production servers.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  // Dev servers compile routes on first visit; allow for that.
  expect: { timeout: 15_000 },
  // A hung run should fail with a report before the CI job times out.
  globalTimeout: process.env.CI ? 20 * 60_000 : undefined,
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    locale: 'bg-BG',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @seo/api start',
      url: 'http://localhost:14000/health/live',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @seo/worker start',
      url: 'http://localhost:4001/health/live',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @seo/web start',
      url: baseURL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});

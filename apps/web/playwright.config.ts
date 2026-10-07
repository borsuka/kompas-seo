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
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
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
      url: 'http://localhost:4000/health/live',
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

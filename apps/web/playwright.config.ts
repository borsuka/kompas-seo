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
  // Plain `node` commands, not `pnpm start`: on Linux the processes behind pnpm survived
  // Playwright's shutdown and kept the run open until the CI job timed out.
  webServer: [
    {
      command: 'node --enable-source-maps dist/main.js',
      cwd: '../api',
      url: 'http://localhost:14000/health/live',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'node --enable-source-maps dist/main.js',
      cwd: '../worker',
      url: 'http://localhost:4001/health/live',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'node scripts/next.mjs start --port 3000',
      cwd: '.',
      url: baseURL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});

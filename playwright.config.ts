import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real product: a real browser against the real web
 * app, the real API and a real PostgreSQL.
 *
 * Before running, start the database in its own terminal and seed it:
 *
 *   npm run db:local        # or: docker compose up postgres
 *   npm run db:seed
 *   npm run test:e2e
 *
 * The API and web servers are started for you by `webServer` below.
 */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4000);
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // The suite shares one database, so tests must not race each other.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: 'guest-mobile',
      use: { ...devices['iPhone 13'] },
      testMatch: /customer-journey\.spec\.ts/,
    },
    {
      name: 'staff-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testMatch: /staff-.*\.spec\.ts/,
    },
  ],

  webServer: [
    {
      command: 'npm run dev:api',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `npm run dev -w @tableflow/web -- --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      url: WEB_URL,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      // Deliberately no VITE_API_URL: the app then calls a same-origin /api,
      // which Vite proxies to the API. That keeps the browser off CORS entirely,
      // and mirrors how nginx serves the two together in production.
      env: { VITE_API_URL: '' },
    },
  ],
});

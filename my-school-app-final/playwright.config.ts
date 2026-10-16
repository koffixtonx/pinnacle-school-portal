import { defineConfig } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

// The specs expect a production bundle: the crash screen is about a chunk that
// 404s, which the dev server does not reproduce. Point E2E_BASE_URL at a
// deployed site to run the same checks against it without serving anything.
const external = !!process.env.E2E_BASE_URL;
const baseURL = process.env.E2E_BASE_URL ?? BASE_URL;

// Playwright's own Chromium build is absent here and cannot be downloaded, so
// take the system browser when one is named.
const executablePath = process.env.E2E_CHROMIUM;
const launchArgs = executablePath ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath, args: launchArgs } } : {}),
  },
  webServer: external
    ? undefined
    : {
        command: `npm run preview -- --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});

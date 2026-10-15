import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the production build (`vite preview`). Pixel 7 emulation, fixed locale/zone so
 * times read as 24 h "06:30". The web backend's test hooks are enabled with `?e2e=1`.
 * Chromium is the preinstalled build pinned by D-005 (never run `playwright install` here).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 7_000 },
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list']],
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://localhost:4173',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

// Browser tests: `npx playwright test` (also runs in CI). Dev-only; nothing here ships.
// The app is served by tools/serve.mjs; dates run in Brisbane time like the real devices.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    timezoneId: 'Australia/Brisbane',
    locale: 'en-AU',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tools/serve.mjs 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    // iPhone: Safari's engine, phone size, touch.
    { name: 'iphone', use: { ...devices['iPhone 15 Pro'], viewport: { width: 402, height: 874 } }, testIgnore: /sync\.spec\.js/ },
    // Mac: wide window → Timer left, History right.
    { name: 'mac', use: { ...devices['Desktop Chrome'], viewport: { width: 1180, height: 760 } } },
  ],
});

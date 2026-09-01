import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for the MerchantOS AI app.
 * https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: require.resolve('./global-setup.ts'),
  fullyParallel: false,
  // Fail the build on CI if someone accidentally left a `.only` in the test
  // file -- a common source of green-but-lying CI runs.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // These specs drive server actions that write to one test database.
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Server actions, LLM tool calls and streamed responses all take longer than
  // Playwright's 5s default assertion timeout, so it is relaxed here rather than
  // sprinkling long per-assertion timeouts through every test.
  expect: {
    timeout: 15_000,
  },
  // Generous enough to contain a whole journey: merchant.spec.ts alone budgets
  // 20s for the cart sweeper plus 45s for the campaign engine, which already
  // exceeds Playwright's 30s default and would exceed a 60s cap in the worst case.
  timeout: 120_000,

  projects: [
    // Signs in once through the real form and saves the session, so the specs
    // don't each pay a login. See tests/e2e/auth.setup.ts.
    { name: 'setup', testMatch: /.*\.setup\.ts/ },

    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],

  // Boots the Next.js app itself so `npx playwright test` works standalone,
  // both locally and on CI. Reuses an already-running `next dev` locally so
  // repeated test runs don't pay startup cost every time.
  webServer: {
    command: 'npm run dev',
    env: {
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
    },
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})

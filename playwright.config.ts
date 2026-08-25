import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for the MerchantOS AI app.
 * https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // Fail the build on CI if someone accidentally left a `.only` in the test
  // file -- a common source of green-but-lying CI runs.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // These specs drive server actions that write to a single shared database, so
  // one worker on CI keeps runs from fighting over that state (and over LLM rate
  // limits, for the chat flows). Locally, parallel workers are fine.
  workers: process.env.CI ? 1 : undefined,
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

    // NOTE: with `fullyParallel` and no CI worker cap, these three run at the
    // same time against ONE dev database, so their writes interleave.
    // merchant.spec.ts is written to tolerate that -- it asserts UI state and
    // KPI rendering, never row counts. If you add a count assertion (e.g.
    // "exactly 3 PROPOSED campaigns"), pin that spec to a single project or run
    // with `--workers=1`, or it will flake for a data reason, not a code reason.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      dependencies: ['setup'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      dependencies: ['setup'],
    },
  ],

  // Boots the Next.js app itself so `npx playwright test` works standalone,
  // both locally and on CI. Reuses an already-running `next dev` locally so
  // repeated test runs don't pay startup cost every time.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})

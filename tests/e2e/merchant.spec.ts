import { test, expect, type Locator, type Page } from '@playwright/test'

/**
 * Merchant E2E: the growth queue writes, then the ROI dashboard reads.
 *
 * Journey covered:
 *   1. Land on /merchant (the Growth Dashboard) as an authenticated merchant.
 *   2. Run the manual Cart Sweeper (Day 10) and wait for the refresh to land.
 *   3. Generate opportunities, driving the Day 2 campaign engine.
 *   4. Move to /merchant/analytics (Day 12) and assert the four KPI cards
 *      rendered with real values.
 *
 * Auth: MerchantLayout redirects to '/' unless the session is a MERCHANT with a
 * linked merchant record, so this runs against the storageState produced by
 * tests/e2e/auth.setup.ts (the `setup` project this one depends on). That file
 * signs in through the real form rather than forging a cookie, so the session
 * this test uses is one the app itself issued.
 */

/** Must match the path auth.setup.ts writes. Resolved relative to the config dir. */
const MERCHANT_STORAGE_STATE = 'playwright/.auth/merchant.json'

/** runCartSweeper is a bounded UPDATE plus a dashboard refresh -- two quick round trips. */
const SWEEPER_TIMEOUT = 20_000

/**
 * generateCampaigns scans carts, orders and products for this merchant and
 * writes a Campaign + AgentAction + AuditLog per opportunity inside a
 * transaction, then refreshes. Slower and more variable than a plain read, so it
 * gets its own budget rather than leaning on the project-wide expect timeout.
 */
const CAMPAIGN_ENGINE_TIMEOUT = 45_000

test.use({ storageState: MERCHANT_STORAGE_STATE })

/**
 * Both button clicks in this file MUTATE shared server state (carts move to
 * ABANDONED, campaign rows get written). Serial mode keeps this file's own steps
 * from interleaving. Note it does NOT serialize across browser projects -- see
 * the comment on `projects` in playwright.config.ts.
 */
test.describe.configure({ mode: 'serial' })

test.describe('Merchant dashboard: growth queue and ROI', () => {
  test('sweeps carts, generates opportunities, then verifies the analytics KPIs', async ({ page }) => {
    await page.goto('/merchant')

    // An auth failure shows up here as a redirect to '/'. Asserting the URL
    // first turns that into "expected /merchant, got /" instead of a confusing
    // "button not found" thirty seconds later.
    await expect(page, 'expected to stay on /merchant -- a redirect to / means the merchant session was not accepted')
      .toHaveURL(/\/merchant$/)

    // page.tsx renders "Loading Shop-Pilot AI..." in place of the whole
    // dashboard until its mount-time fetch resolves and setLoading(false) runs.
    // Waiting for a real control to appear is the correct readiness signal --
    // no sleep, and no networkidle (which a streamed RSC payload can defeat).
    const sweeperButton = sweeper(page)
    const generateButton = generator(page)
    await expect(sweeperButton).toBeVisible()
    await expect(page.getByText(/Loading Shop-Pilot AI/i)).toHaveCount(0)

    // --- 1. Run Cart Sweeper (Day 10) ------------------------------------
    await clickAndSettle(page, sweeperButton, 'Run Cart Sweeper', SWEEPER_TIMEOUT)

    // --- 2. Generate opportunities (Day 2 campaign engine) ---------------
    // Deliberately no assertion on how many campaign cards appear: generation
    // is grounded in real data, so with an unseeded database the correct
    // outcome is zero campaigns. Asserting a count here would make the test
    // fail for a database reason rather than a code reason. `npm run
    // db:seed:demo` is what makes the queue non-empty.
    await clickAndSettle(page, generateButton, 'Generate opportunities', CAMPAIGN_ENGINE_TIMEOUT)

    // --- 3. Analytics KPIs (Day 12) --------------------------------------
    await page.goto('/merchant/analytics')
    await expect(page).toHaveURL(/\/merchant\/analytics$/)
    await assertKpiCardsVisible(page)
  })
})

/**
 * Located by a regex spanning BOTH label states, because the label is the thing
 * under test: `{sweeping ? 'Sweeping…' : 'Run Cart Sweeper'}`. A locator pinned
 * to the idle name alone would silently resolve to zero elements mid-flight,
 * which makes the "label reverted" assertion below tautological -- it would pass
 * by waiting for its own selector rather than by observing the transition.
 */
function sweeper(page: Page): Locator {
  return page.getByRole('button', { name: /run cart sweeper|sweeping/i })
}

/** Same two-state reasoning as `sweeper`, for `{generating ? 'Generating…' : ...}`.
 *  getByRole (not getByText) matters here: the campaigns empty state renders the
 *  prose "No campaigns yet. Generate opportunities to get AI-proposed
 *  campaigns.", so a text locator would be ambiguous. */
function generator(page: Page): Locator {
  return page.getByRole('button', { name: /generate opportunities|generating/i })
}

/**
 * Clicks a dashboard action button and waits for the work behind it to finish.
 *
 * Both handlers share one shape:
 *   setPending(true) -> await <serverAction>() -> await refreshData() -> setPending(false)
 * and that single flag drives both the label and `disabled`. So waiting for the
 * label to revert AND the button to re-enable *is* waiting for the action plus
 * the dashboard refresh -- a real UI state, not a timing guess.
 *
 * The response wait closes the remaining gap. Without it, a fast round trip
 * could complete before the first assertion polls, and "label is idle" would
 * pass against a button that never left idle -- green while proving nothing.
 * Registering the wait before the click makes that unmissable.
 */
async function clickAndSettle(page: Page, button: Locator, idleLabel: string, timeout: number) {
  await expect(button).toBeVisible()
  await expect(button).toBeEnabled()

  // App Router posts server actions back to the current route's own URL. The
  // predicate stays deliberately loose (method + pathname) rather than sniffing
  // the Next-Action header, so a Next internals change doesn't break the test.
  // /merchant has no interval polling -- its only other refreshData() runs on
  // mount and has already settled by the time the button is visible -- so the
  // first POST after the click is ours.
  const actionRoundTrip = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/merchant',
    { timeout },
  )

  await button.click()
  await actionRoundTrip

  await expect(button, `"${idleLabel}" should return to its idle label once the action and refresh complete`)
    .toHaveText(idleLabel, { timeout })
  await expect(button).toBeEnabled()
}

/**
 * The four KPI cards on /merchant/analytics, each rendered by MetricCard, which
 * puts its `title` in an <h3> and its `value` in a sibling <div>.
 *
 * getByRole('heading') rather than getByText is load-bearing: ImpactBar on the
 * same page renders an "AI Revenue Impact" heading and a "Total Revenue:" label,
 * so a bare /revenue/i text locator matches three elements and would need a
 * `.first()` that could silently latch onto the wrong one. Scoping to headings
 * and matching the distinguishing words keeps each locator to exactly one card.
 *
 * `heading` patterns are wider than the current copy so a wording tweak doesn't
 * fail the run, but each still names the metric it stands for -- notably the
 * fourth card, which reports only discount-policy blocks rather than claiming
 * every blocked action represents protected margin.
 *
 * `value` patterns exist because a card can render its label while the number
 * behind it is broken -- which is exactly what a shape mismatch between
 * getMerchantROI() and the page looks like. They are matched against the card,
 * not the page: ImpactBar renders `{percentage.toFixed(1)}%` unconditionally, so
 * a page-wide percentage assertion would pass via ImpactBar even if the upsell
 * card were empty, and prove nothing.
 */
const KPI_CARDS: ReadonlyArray<{ metric: string; heading: RegExp; value: RegExp }> = [
  // (roiData.totalRevenueGenerated / 100).toLocaleString('en-IN', INR)
  { metric: 'Revenue', heading: /revenue generated|total revenue/i, value: /₹/ },
  // .toLocaleString() on a count
  { metric: 'Carts Recovered', heading: /carts?\s+recovered|recovered\s+carts?/i, value: /\d/ },
  // Cross-sell
  { metric: 'Cross-Sell Rate', heading: /cross-sell/i, value: /\d+(\.\d+)?%|[—–]/ },
  // Upsell
  { metric: 'Upsell Rate', heading: /upsell/i, value: /\d+(\.\d+)?%|[—–]/ },
  { metric: 'Discount Policy Blocks', heading: /discount\s+policy\s+blocks?/i, value: /\d/ },
]

/**
 * MetricCard nests as: <div card> <div flex><h3>{title}</h3></div> <div>{value}</div> </div>
 * so the card root is the heading's grandparent. Walking up from the heading
 * keeps this independent of MetricCard's Tailwind classes, which vary with
 * `accentColor` and are the most likely thing to be restyled.
 */
function kpiCard(page: Page, heading: RegExp): Locator {
  return page.getByRole('heading', { name: heading }).locator('xpath=../..')
}

async function assertKpiCardsVisible(page: Page) {
  for (const { metric, heading, value } of KPI_CARDS) {
    const card = kpiCard(page, heading)

    await expect(card, `KPI card for "${metric}" should be visible on /merchant/analytics`).toBeVisible()
    await expect(card, `KPI card for "${metric}" should render a value, not an empty slot`).toContainText(value)
  }

  // Nothing anywhere on the page should have leaked a bad value -- the signature
  // of a field-name mismatch against what getMerchantROI() returns.
  await expect(
    page.getByText(/\b(undefined|NaN|Infinity)\b/),
    'no KPI should render undefined/NaN/Infinity -- that means a field name mismatch against getMerchantROI()',
  ).toHaveCount(0)

  // ImpactBar consumes two more aggregate fields, so it is the part of the page
  // most sensitive to that same mismatch.
  await expect(page.getByRole('heading', { name: /ai revenue impact/i })).toBeVisible()
}

import { test as setup, expect } from '@playwright/test'

/**
 * Produces the merchant storageState that merchant.spec.ts runs against.
 *
 * This signs in through the real form on '/' -- which calls the `authenticate`
 * server action and lets it set the shoppilot_session cookie -- rather than
 * forging a cookie by hand. That keeps the fixture honest: if the login flow or
 * the session shape changes, this fails loudly here instead of producing a
 * cookie the app quietly rejects further downstream.
 *
 * Runs once as the `setup` project; the browser projects depend on it.
 */

/** Must match MERCHANT_STORAGE_STATE in merchant.spec.ts. Gitignored -- it holds a live session cookie. */
const MERCHANT_STORAGE_STATE = 'playwright/.auth/merchant.json'

/**
 * Defaults mirror prisma/seed.ts, which upserts the TechNest admin from these
 * same two variables. Override both here and in the seed if you change them.
 */
const MERCHANT_EMAIL = process.env.MERCHANT_ADMIN_EMAIL || 'admin@technest.com'
const MERCHANT_PASSWORD = process.env.MERCHANT_ADMIN_PASSWORD || 'technest-demo-2026'

setup('authenticate as merchant', async ({ page }) => {
  await page.goto('/')

  // The inputs are wrapped in their <label>, so the implicit association is what
  // getByLabel resolves -- no test-only ids needed in app code.
  await page.getByLabel('Email').fill(MERCHANT_EMAIL)
  await page.getByLabel('Password').fill(MERCHANT_PASSWORD)

  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // authenticate() resolves { role }, and the page pushes merchants to
  // /merchant/portal. Landing there proves the cookie was both set and honoured.
  try {
    await page.waitForURL(/\/merchant\/portal$/, { timeout: 30_000 })
  } catch (cause) {
    // By far the most likely failure is an unseeded database, and a bare 30s
    // timeout says nothing about that. The form surfaces the real reason in a
    // role="alert", so read it back instead of discarding it.
    const alert = page.getByRole('alert')
    if (await alert.isVisible().catch(() => false)) {
      throw new Error(
        `Merchant sign-in was rejected: "${(await alert.innerText()).trim()}". ` +
          `Expected ${MERCHANT_EMAIL} to exist as a MERCHANT -- run \`npx prisma db seed\` first, ` +
          `or set MERCHANT_ADMIN_EMAIL / MERCHANT_ADMIN_PASSWORD to match your database.`,
      )
    }
    throw cause
  }

  // The portal is a client component; waiting for its heading means the session
  // survived the navigation rather than just the redirect having been issued.
  await expect(page.getByRole('heading', { name: /shop-pilot hub/i })).toBeVisible()

  await page.context().storageState({ path: MERCHANT_STORAGE_STATE })
})

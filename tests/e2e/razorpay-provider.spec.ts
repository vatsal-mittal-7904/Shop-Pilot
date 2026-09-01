import { test, expect } from '@playwright/test'
import Razorpay from 'razorpay'

const CUSTOMER_EMAIL = process.env.DEMO_CUSTOMER_EMAIL || 'demo.customer@technest.com'
const CUSTOMER_PASSWORD = process.env.DEMO_CUSTOMER_PASSWORD || 'technest-customer-demo'

/**
 * This is intentionally not part of the default E2E run. It crosses a real
 * external money-provider boundary (Razorpay test mode), so it requires both
 * an explicitly resettable database and explicit human opt-in:
 *
 *   TEST_DATABASE_URL=... npm run test:razorpay:proof
 *
 * It does not use Vitest fixtures or mock the SDK. The test independently
 * fetches both the order and its payments from Razorpay after the app has
 * created it, proving the provider API contract rather than a local state
 * transition. A captured-payment proof remains a manual/dashboard exercise
 * because it needs a public webhook URL and a real test checkout completion.
 */
test.describe('Razorpay test-mode provider proof', () => {
  test.skip(process.env.RUN_RAZORPAY_LIVE_E2E !== '1', 'Set RUN_RAZORPAY_LIVE_E2E=1 to call Razorpay test mode.')

  test('creates and retrieves a customer-approved order through the real Razorpay test-mode API', async ({ page }, testInfo) => {
    await page.goto('/')
    await page.getByLabel('Email').fill(CUSTOMER_EMAIL)
    await page.getByLabel('Password').fill(CUSTOMER_PASSWORD)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page).toHaveURL(/\/agent$/)

    const catalog = await page.request.get('/api/agent/catalog')
    expect(catalog.ok()).toBeTruthy()
    const catalogData = await catalog.json() as { products: Array<{ id: string }> }
    expect(catalogData.products.length).toBeGreaterThan(0)

    const cart = await page.request.post('/api/agent/cart', { data: { productId: catalogData.products[0].id } })
    expect(cart.ok()).toBeTruthy()

    const offerResponse = await page.request.post('/api/agent/offer', { data: { discountPercentage: 0 } })
    expect(offerResponse.ok()).toBeTruthy()
    const { offer } = await offerResponse.json() as { offer: { id: string; total: number } }

    const acceptance = await page.request.post('/api/agent/offer/accept', { data: { offerId: offer.id } })
    expect(acceptance.ok()).toBeTruthy()

    const checkoutResponse = await page.request.post('/api/agent/order', { data: { offerId: offer.id } })
    expect(checkoutResponse.ok()).toBeTruthy()
    const checkout = await checkoutResponse.json() as {
      internalOrderId: string
      razorpayOrder: { id: string; amount: number; currency: string }
    }

    expect(checkout.razorpayOrder.id).toMatch(/^order_/)
    expect(checkout.razorpayOrder.amount).toBe(offer.total)
    expect(checkout.razorpayOrder.currency).toBe('INR')

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    })
    const providerOrder = await razorpay.orders.fetch(checkout.razorpayOrder.id)

    expect(providerOrder.id).toBe(checkout.razorpayOrder.id)
    expect(Number(providerOrder.amount)).toBe(offer.total)
    expect(providerOrder.currency).toBe('INR')
    expect(providerOrder.receipt).toBe(`mso_${checkout.internalOrderId}`)
    expect(providerOrder.status).toBe('created')
    expect(providerOrder.notes).toMatchObject({ internalOrderId: checkout.internalOrderId })

    // Exercises a second provider endpoint used by the reconciliation worker.
    // A newly-created, unpaid order must not fabricate a successful payment.
    const providerPayments = await razorpay.orders.fetchPayments(checkout.razorpayOrder.id)
    expect(Array.isArray(providerPayments.items)).toBe(true)
    expect(providerPayments.items).toHaveLength(0)

    testInfo.annotations.push({
      type: 'razorpay-provider-proof',
      description: `Verified real test-mode order ${providerOrder.id}; receipt ${providerOrder.receipt}; amount ${providerOrder.amount} ${providerOrder.currency}.`,
    })
  })
})

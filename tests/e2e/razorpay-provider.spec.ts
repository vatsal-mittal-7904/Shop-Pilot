import { test, expect } from '@playwright/test'
import Razorpay from 'razorpay'
import crypto from 'node:crypto'

const CUSTOMER_EMAIL = process.env.DEMO_CUSTOMER_EMAIL || 'demo.customer@technest.com'
const CUSTOMER_PASSWORD = process.env.DEMO_CUSTOMER_PASSWORD || 'technest-customer-demo'
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret'

function signWebhookPayload(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
}

/**
 * Validates a real Razorpay Test Mode order plus this application's local
 * Validates a real Razorpay Test Mode order plus this application's local
 * webhook-signature and duplicate-delivery handling. 
 *
 * CRITICAL CLARIFICATION:
 * This is a CONTRACT TEST. It uses a locally signed payload to verify the 
 * handler logic. It does NOT assert that Razorpay successfully delivered a 
 * live webhook over the internet to this application, which requires an 
 * active tunnel (like ngrok) and is out of scope for CI runners.
 *
 *   RUN_RAZORPAY_LIVE_E2E=1 npm run test:razorpay:proof
 */
test.describe('Razorpay test-mode order contract and local webhook route handling', () => {
  test.skip(process.env.RUN_RAZORPAY_LIVE_E2E !== '1', 'Set RUN_RAZORPAY_LIVE_E2E=1 to call Razorpay test mode.')

  test('creates and retrieves a real Test Mode order, then exercises the local webhook handler', async ({ page }, testInfo) => {
    // 1. Authenticate as customer
    await page.goto('/')
    const emailInput = page.getByLabel('Email')
    await emailInput.waitFor({ state: 'visible' })
    await emailInput.fill(CUSTOMER_EMAIL)
    const passwordInput = page.getByLabel('Password')
    await passwordInput.fill(CUSTOMER_PASSWORD)
    await expect(emailInput).toHaveValue(CUSTOMER_EMAIL)
    await expect(passwordInput).toHaveValue(CUSTOMER_PASSWORD)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page).toHaveURL(/\/agent$/, { timeout: 15_000 })

    // 2. Fetch catalog and populate basket
    const catalog = await page.request.get('/api/agent/catalog')
    expect(catalog.ok()).toBeTruthy()
    const catalogData = (await catalog.json()) as {
      merchant?: { id: string }
      products: Array<{ id: string }>
    }
    expect(catalogData.products.length).toBeGreaterThan(0)

    const cart = await page.request.post('/api/agent/cart', { data: { productId: catalogData.products[0].id } })
    expect(cart.ok()).toBeTruthy()

    // 3. Create and accept offer
    const offerResponse = await page.request.post('/api/agent/offer', {
      data: { discountPercentage: 0, merchantId: catalogData.merchant?.id },
    })
    expect(offerResponse.ok()).toBeTruthy()
    const { offer } = (await offerResponse.json()) as { offer: { id: string; total: number } }

    const acceptance = await page.request.post('/api/agent/offer/accept', { data: { offerId: offer.id } })
    expect(acceptance.ok()).toBeTruthy()

    // 4. Create internal order and live Razorpay order
    const checkoutResponse = await page.request.post('/api/agent/order', { data: { offerId: offer.id } })
    expect(checkoutResponse.ok()).toBeTruthy()
    const checkout = (await checkoutResponse.json()) as {
      internalOrderId: string
      razorpayOrder: { id: string; amount: number; currency: string }
    }

    expect(checkout.razorpayOrder.id).toMatch(/^order_/)
    expect(checkout.razorpayOrder.amount).toBe(offer.total)
    expect(checkout.razorpayOrder.currency).toBe('INR')

    // 5. Independently verify order with Razorpay test-mode API
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

    const providerPayments = await razorpay.orders.fetchPayments(checkout.razorpayOrder.id)
    expect(Array.isArray(providerPayments.items)).toBe(true)
    expect(providerPayments.items).toHaveLength(0)

    // 6. Exercise the route's signature and idempotency behavior with a
    // locally signed fixture. This is a handler contract test, not provider
    // lifecycle evidence.
    const simulatedPaymentId = `pay_proof_${Date.now()}`
    const eventId = `evt_proof_${Date.now()}`
    const webhookPayload = JSON.stringify({
      entity: 'event',
      account_id: 'acc_test_123',
      event: 'payment.captured',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: simulatedPaymentId,
            entity: 'payment',
            amount: offer.total,
            currency: 'INR',
            status: 'captured',
            order_id: checkout.razorpayOrder.id,
            invoice_id: null,
            international: false,
            method: 'card',
            amount_refunded: 0,
            refund_status: null,
            captured: true,
            description: `Payment for order ${checkout.internalOrderId}`,
            card_id: 'card_proof_123',
            bank: null,
            wallet: null,
            vpa: null,
            email: CUSTOMER_EMAIL,
            contact: '+919999999999',
            notes: { internalOrderId: checkout.internalOrderId },
            fee: 0,
            tax: 0,
            error_code: null,
            error_description: null,
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      },
      created_at: Math.floor(Date.now() / 1000),
    })

    const validSignature = signWebhookPayload(webhookPayload, WEBHOOK_SECRET)

    // Test tamper rejection
    const tamperedResponse = await page.request.post('/api/webhooks/razorpay', {
      headers: {
        'x-razorpay-signature': '0000000000000000000000000000000000000000000000000000000000000000',
        'x-razorpay-event-id': eventId,
        'Content-Type': 'application/json',
      },
      data: webhookPayload,
    })
    expect(tamperedResponse.status()).toBe(400)
    expect(await tamperedResponse.json()).toEqual({ error: 'Invalid signature' })

    // Test successful signed webhook processing
    const liveWebhookResponse = await page.request.post('/api/webhooks/razorpay', {
      headers: {
        'x-razorpay-signature': validSignature,
        'x-razorpay-event-id': eventId,
        'Content-Type': 'application/json',
      },
      data: webhookPayload,
    })
    expect(liveWebhookResponse.status()).toBe(200)
    expect(await liveWebhookResponse.json()).toEqual({ status: 'ok' })

    // Test idempotent duplicate redelivery
    const duplicateWebhookResponse = await page.request.post('/api/webhooks/razorpay', {
      headers: {
        'x-razorpay-signature': validSignature,
        'x-razorpay-event-id': eventId,
        'Content-Type': 'application/json',
      },
      data: webhookPayload,
    })
    expect(duplicateWebhookResponse.status()).toBe(200)
    expect(await duplicateWebhookResponse.json()).toEqual({ status: 'already_processed' })

    testInfo.annotations.push({
      type: 'razorpay-order-contract-and-local-webhook-handler',
      description: `Verified real Test Mode order ${providerOrder.id}; exercised local webhook signature and duplicate-delivery handling with fixture event ${eventId}. This test does not assert provider-originated webhook delivery.`,
    })
  })
})

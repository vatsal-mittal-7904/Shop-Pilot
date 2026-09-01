import { beforeEach, describe, expect, test, vi } from 'vitest'
import crypto from 'node:crypto'

const mocks = vi.hoisted(() => ({
  webhookFindUnique: vi.fn(),
  processRazorpayEvent: vi.fn(),
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    webhookEvent: {
      findUnique: mocks.webhookFindUnique,
    },
  },
}))

vi.mock('@/backend/actions/webhookProcessor', () => ({
  processRazorpayEvent: mocks.processRazorpayEvent,
}))

import { POST } from '@/app/api/webhooks/razorpay/route'

const WEBHOOK_SECRET = 'test_webhook_secret_key_12345'

function computeHmacSignature(rawBody: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
}

describe('Razorpay Live Webhook Capture & HMAC Signature Proof', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET
    mocks.webhookFindUnique.mockResolvedValue(null)
    mocks.processRazorpayEvent.mockResolvedValue({ count: 1 })
  })

  test('accepts and processes a genuine HMAC-SHA256 signed payment.captured webhook', async () => {
    const payload = JSON.stringify({
      entity: 'event',
      account_id: 'acc_123',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_live_proof_123',
            order_id: 'order_live_123',
            amount: 749900,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    })
    const signature = computeHmacSignature(payload, WEBHOOK_SECRET)
    const eventId = 'evt_live_test_123'

    const req = new Request('http://localhost:3000/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId,
      },
      body: payload,
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'ok' })

    expect(mocks.processRazorpayEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'payment.captured',
        razorpayEventId: eventId,
      }),
    )
  })

  test('strictly rejects a tampered or invalid webhook signature with 400', async () => {
    const payload = JSON.stringify({ event: 'payment.captured' })
    const wrongSignature = computeHmacSignature(payload, 'wrong_secret')
    const eventId = 'evt_live_test_tampered'

    const req = new Request('http://localhost:3000/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': wrongSignature,
        'x-razorpay-event-id': eventId,
      },
      body: payload,
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid signature' })

    expect(mocks.processRazorpayEvent).not.toHaveBeenCalled()
  })

  test('acknowledges duplicate event deliveries idempotently without reprocessing', async () => {
    const payload = JSON.stringify({ event: 'payment.captured' })
    const signature = computeHmacSignature(payload, WEBHOOK_SECRET)
    const eventId = 'evt_live_duplicate'

    // Mock that event has already been committed to the WebhookEvent ledger
    mocks.webhookFindUnique.mockResolvedValue({ id: 'wh_1', razorpayEventId: eventId })

    const req = new Request('http://localhost:3000/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId,
      },
      body: payload,
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'already_processed' })

    expect(mocks.processRazorpayEvent).not.toHaveBeenCalled()
  })
})

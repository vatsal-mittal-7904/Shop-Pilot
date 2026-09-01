import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  merchantFindMany: vi.fn(),
  refundFindMany: vi.fn(),
  reconciliationFindMany: vi.fn(),
  auditLogCreate: vi.fn(),
  markAbandonedCarts: vi.fn(),
  processPendingRefunds: vi.fn(),
  processPendingPaymentReconciliations: vi.fn(),
  expireStaleOrders: vi.fn(),
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    merchant: { findMany: mocks.merchantFindMany },
    refund: { findMany: mocks.refundFindMany },
    paymentReconciliation: { findMany: mocks.reconciliationFindMany },
    auditLog: { create: mocks.auditLogCreate },
  },
}))

vi.mock('@/backend/actions/cartSweeper', () => ({
  markAbandonedCarts: mocks.markAbandonedCarts,
}))

vi.mock('@/backend/actions/refundProcessor', () => ({
  processPendingRefunds: mocks.processPendingRefunds,
}))

vi.mock('@/backend/actions/paymentReconciliation', () => ({
  processPendingPaymentReconciliations: mocks.processPendingPaymentReconciliations,
}))

vi.mock('@/backend/actions/orderExpiry', () => ({
  expireStaleOrders: mocks.expireStaleOrders,
}))

import { GET } from '@/app/api/cron/sweep-carts/route'
import { checkQueueHealth } from '@/backend/actions/queueMonitor'

const CRON_SECRET = 'test-cron-secret-12345'
const MERCHANT_ID = '11111111-1111-4111-8111-111111111111'

describe('Cron Sweep Carts Route & Queue Age Monitoring', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    mocks.merchantFindMany.mockResolvedValue([{ id: MERCHANT_ID }])
    mocks.markAbandonedCarts.mockResolvedValue({ updatedCount: 2, thresholdMinutes: 30 })
    mocks.processPendingRefunds.mockResolvedValue({ attempted: 1, skipped: 0 })
    mocks.processPendingPaymentReconciliations.mockResolvedValue({ attempted: 1, skipped: 0, resolved: 1 })
    mocks.expireStaleOrders.mockResolvedValue({ expiredCount: 0, expiredOrderIds: [], evaluatedCount: 0 })
    mocks.refundFindMany.mockResolvedValue([])
    mocks.reconciliationFindMany.mockResolvedValue([])
    mocks.auditLogCreate.mockResolvedValue({})
  })

  test('returns 500 if CRON_SECRET is not configured on the server', async () => {
    delete process.env.CRON_SECRET
    const req = new Request('http://localhost:3000/api/cron/sweep-carts', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })

    const res = await GET(req)
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'Server misconfiguration' })
  })

  test('returns 401 if authorization header is missing or incorrect', async () => {
    const reqWithoutAuth = new Request('http://localhost:3000/api/cron/sweep-carts')
    const resWithoutAuth = await GET(reqWithoutAuth)
    expect(resWithoutAuth.status).toBe(401)
    await expect(resWithoutAuth.json()).resolves.toEqual({ error: 'Unauthorized' })

    const reqWrongAuth = new Request('http://localhost:3000/api/cron/sweep-carts', {
      headers: { authorization: 'Bearer wrong-secret' },
    })
    const resWrongAuth = await GET(reqWrongAuth)
    expect(resWrongAuth.status).toBe(401)
    await expect(resWrongAuth.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  test('successfully executes cart sweep, refund processing, reconciliation and returns queue health on authenticated call', async () => {
    const req = new Request('http://localhost:3000/api/cron/sweep-carts', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })

    const res = await GET(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.totalUpdated).toBe(2)
    expect(data.merchants).toEqual([{ merchantId: MERCHANT_ID, updatedCount: 2, thresholdMinutes: 30 }])
    expect(data.refunds).toEqual({ attempted: 1, skipped: 0 })
    expect(data.payments).toEqual({ attempted: 1, skipped: 0, resolved: 1 })
    expect(data.expiredOrders).toEqual({ expiredCount: 0, expiredOrderIds: [], evaluatedCount: 0 })
    expect(data.queueHealth).toMatchObject({
      isHealthy: true,
      hasCriticalAlerts: false,
      refunds: { pendingCount: 0, oldestAgeMinutes: null, highAttemptCount: 0 },
      paymentReconciliations: { pendingCount: 0, oldestAgeMinutes: null, highAttemptCount: 0 },
      alerts: [],
    })

    expect(mocks.markAbandonedCarts).toHaveBeenCalledWith(MERCHANT_ID)
    expect(mocks.processPendingRefunds).toHaveBeenCalled()
    expect(mocks.processPendingPaymentReconciliations).toHaveBeenCalled()
    expect(mocks.expireStaleOrders).toHaveBeenCalled()
  })

  test('detects and alerts when pending refunds exceed the warning age threshold (15m)', async () => {
    const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000)
    mocks.refundFindMany.mockResolvedValue([
      { id: 'ref-1', createdAt: twentyMinsAgo, attemptCount: 1, order: { merchantId: MERCHANT_ID } },
    ])

    const health = await checkQueueHealth(MERCHANT_ID)
    expect(health.isHealthy).toBe(false)
    expect(health.hasCriticalAlerts).toBe(false)
    expect(health.refunds.pendingCount).toBe(1)
    expect(health.refunds.oldestAgeMinutes).toBeGreaterThanOrEqual(20)
    expect(health.alerts).toHaveLength(1)
    expect(health.alerts[0]).toMatchObject({
      queue: 'REFUND',
      severity: 'WARN',
      count: 1,
    })
  })

  test('detects, logs, and creates an audit log when payment reconciliations exceed the critical age threshold (30m)', async () => {
    const fortyMinsAgo = new Date(Date.now() - 40 * 60 * 1000)
    mocks.reconciliationFindMany.mockResolvedValue([
      { id: 'rec-1', createdAt: fortyMinsAgo, attemptCount: 3, order: { merchantId: MERCHANT_ID } },
    ])

    const health = await checkQueueHealth(MERCHANT_ID)
    expect(health.isHealthy).toBe(false)
    expect(health.hasCriticalAlerts).toBe(true)
    expect(health.paymentReconciliations.pendingCount).toBe(1)
    expect(health.paymentReconciliations.oldestAgeMinutes).toBeGreaterThanOrEqual(40)
    expect(health.alerts).toHaveLength(1)
    expect(health.alerts[0]).toMatchObject({
      queue: 'PAYMENT_RECONCILIATION',
      severity: 'CRITICAL',
      count: 1,
    })

    expect(mocks.auditLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'QUEUE_AGE_ALERT',
        status: 'BLOCKED',
        merchantId: MERCHANT_ID,
      }),
    }))
  })
})

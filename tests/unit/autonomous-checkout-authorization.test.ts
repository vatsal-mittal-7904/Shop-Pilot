import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireCustomer: vi.fn(),
  transaction: vi.fn(),
  checkDistributedRateLimit: vi.fn(),
}))

vi.mock('@/backend/auth/session', () => ({
  requireCustomer: mocks.requireCustomer,
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/backend/utils/rateLimit', () => ({
  checkDistributedRateLimit: mocks.checkDistributedRateLimit,
}))

import { acceptOfferForCheckout } from '@/backend/actions/order'
import { authorizeCustomerAutonomousMode } from '@/backend/actions/intent'

describe('Pre-Authorized Autonomous Checkout Execution', () => {
  const mockCustomer = {
    id: 'cust-123',
    dailySpendLimit: 5000000,
    monthlySpendLimit: 20000000,
    deliveryProfile: {
      autonomousCheckoutEnabled: true,
      autonomousSpendCeiling: 1000000, // ₹10,000
    },
  }

  const mockUser = {
    id: 'user-123',
    email: 'buyer@example.com',
  }

  const validOfferId = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d'

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkDistributedRateLimit.mockResolvedValue({ allowed: true })
    mocks.requireCustomer.mockResolvedValue({ user: mockUser, customer: mockCustomer })
  })

  it('allows manual offer acceptance without autonomous pre-authorization', async () => {
    const tx = {
      offer: {
        findFirst: vi.fn().mockResolvedValue({
          id: validOfferId,
          merchantId: 'merch-1',
          total: 850000,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 60000),
          cartSnapshotHash: null,
          cartId: null,
          campaignId: null,
          items: [{ quantity: 1, product: { inventory: 5 } }],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    mocks.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx))

    const result = await acceptOfferForCheckout(validOfferId)
    expect(result.alreadyAccepted).toBe(false)
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'OFFER_ACCEPTED_BY_CUSTOMER',
          status: 'APPROVED',
        }),
      })
    )
  })

  it('executes pre-authorized autonomous checkout when customer profile permits it', async () => {
    const tx = {
      offer: {
        findFirst: vi.fn().mockResolvedValue({
          id: validOfferId,
          merchantId: 'merch-1',
          total: 750000, // ₹7,500 <= ₹10,000 ceiling
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 60000),
          cartSnapshotHash: null,
          cartId: null,
          campaignId: null,
          buyerIntent: null,
          items: [{ quantity: 1, product: { inventory: 5 } }],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    mocks.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx))

    const result = await acceptOfferForCheckout(validOfferId, { isPreAuthorizedAutonomous: true })
    expect(result.alreadyAccepted).toBe(false)
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'CUSTOMER_PREAUTHORIZED_AUTONOMOUS_ACCEPTANCE',
          status: 'APPROVED',
          reason: expect.stringContaining('pre-authorized autonomous agent checkout'),
          details: expect.objectContaining({
            isPreAuthorizedAutonomous: true,
          }),
        }),
      })
    )
  })

  it('rejects pre-authorized autonomous checkout if customer has not enabled it', async () => {
    mocks.requireCustomer.mockResolvedValue({
      user: mockUser,
      customer: {
        ...mockCustomer,
        deliveryProfile: { autonomousCheckoutEnabled: false },
      },
    })

    const tx = {
      offer: {
        findFirst: vi.fn().mockResolvedValue({
          id: validOfferId,
          merchantId: 'merch-1',
          total: 500000,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 60000),
          cartSnapshotHash: null,
          cartId: null,
          campaignId: null,
          buyerIntent: { autonomousPurchase: false },
          items: [{ quantity: 1, product: { inventory: 5 } }],
        }),
      },
    }
    mocks.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx))

    await expect(
      acceptOfferForCheckout(validOfferId, { isPreAuthorizedAutonomous: true })
    ).rejects.toThrow('Autonomous checkout not authorized for this customer')
  })

  it('rejects pre-authorized autonomous checkout if offer total exceeds spend ceiling', async () => {
    const tx = {
      offer: {
        findFirst: vi.fn().mockResolvedValue({
          id: validOfferId,
          merchantId: 'merch-1',
          total: 1500000, // ₹15,000 > ₹10,000 ceiling
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 60000),
          cartSnapshotHash: null,
          cartId: null,
          campaignId: null,
          buyerIntent: null,
          items: [{ quantity: 1, product: { inventory: 5 } }],
        }),
      },
    }
    mocks.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx))

    await expect(
      acceptOfferForCheckout(validOfferId, { isPreAuthorizedAutonomous: true })
    ).rejects.toThrow('exceeds authorized autonomous spend ceiling')
  })

  it('authorizes customer autonomous mode and updates audit log', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      customer: {
        findUnique: vi.fn().mockResolvedValue({
          dailySpendLimit: 5000000,
          deliveryProfile: {},
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      buyerIntent: {
        findFirst: vi.fn().mockResolvedValue({ id: 'intent-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
    }
    mocks.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx))

    const res = await authorizeCustomerAutonomousMode({
      customerId: 'cust-123',
      actorUserId: 'user-123',
      enabled: true,
      spendCeilingPaise: 800000,
    })

    expect(res.success).toBe(true)
    expect(res.autonomousCheckoutEnabled).toBe(true)
    expect(res.autonomousSpendCeiling).toBe(800000)
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'CUSTOMER_AUTONOMOUS_MODE_UPDATED',
          status: 'APPROVED',
        }),
      })
    )
  })

  it('rejects autonomous spend ceiling if it exceeds customer daily spend limit', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      customer: {
        findUnique: vi.fn().mockResolvedValue({
          dailySpendLimit: 5000000, // ₹50,000
          deliveryProfile: {},
        }),
      },
    }
    mocks.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx))

    await expect(
      authorizeCustomerAutonomousMode({
        customerId: 'cust-123',
        actorUserId: 'user-123',
        enabled: true,
        spendCeilingPaise: 6000000, // ₹60,000 > ₹50,000
      })
    ).rejects.toThrow('Autonomous spend ceiling cannot exceed account daily limit')
  })
})

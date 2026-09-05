import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireCustomer: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/backend/auth/session', () => ({
  requireCustomer: mocks.requireCustomer,
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}))

import { updateAutonomousSettings } from '@/backend/actions/autonomousMode'

describe('Autonomous Mode Settings & Spend Ceiling Guardrails', () => {
  const mockCustomer = {
    id: 'cust-uuid-1',
    dailySpendLimit: 5000000, // ₹50,000
    monthlySpendLimit: 20000000, // ₹200,000
    deliveryProfile: {
      address: '42 Baker Street',
    },
  }

  const mockUser = {
    id: 'user-uuid-1',
    email: 'autonomous.buyer@example.com',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireCustomer.mockResolvedValue({ user: mockUser, customer: mockCustomer })
  })

  it('successfully updates autonomous settings and enables pre-authorization with valid limits', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      customer: {
        findUnique: vi.fn().mockResolvedValue({
          dailySpendLimit: 5000000, // ₹50,000
          deliveryProfile: { address: '42 Baker Street' },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      buyerIntent: {
        findFirst: vi.fn().mockResolvedValue({ id: 'intent-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      merchant: {
        findFirst: vi.fn().mockResolvedValue({ id: 'merch-demo-1' }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-log-1' }),
      },
    }

    mocks.transaction.mockImplementation(async (callback: (t: typeof tx) => Promise<unknown>) => {
      return callback(tx)
    })

    const result = await updateAutonomousSettings({
      enabled: true,
      spendCeilingPaise: 2000000, // ₹20,000 <= ₹50,000
      maxOrderSpendLimitPaise: 1000000, // ₹10,000 <= ₹20,000
    })

    expect(result.success).toBe(true)
    expect(result.enabled).toBe(true)
    expect(result.autonomousSpendCeilingPaise).toBe(2000000)
    expect(result.maxOrderSpendLimitPaise).toBe(1000000)

    // Asserts row-lock was taken
    expect(tx.$executeRaw).toHaveBeenCalled()

    // Asserts customer deliveryProfile was updated with autonomous flags
    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: mockCustomer.id },
      data: {
        deliveryProfile: {
          address: '42 Baker Street',
          autonomousCheckoutEnabled: true,
          autonomousSpendCeiling: 2000000,
          maxOrderSpendLimit: 1000000,
        },
      },
    })

    // Asserts buyerIntent was marked autonomous
    expect(tx.buyerIntent.update).toHaveBeenCalledWith({
      where: { id: 'intent-1' },
      data: {
        autonomousPurchase: true,
        requiresConfirmation: false,
      },
    })

    // Asserts immutable audit log entry was written
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: 'merch-demo-1',
        actorUserId: mockUser.id,
        action: 'AUTONOMOUS_CHECKOUT_PREAUTHORIZATION_UPDATED',
        status: 'EXECUTED',
      }),
    })
  })

  it('disables autonomous checkout and marks buyer intent to require confirmation', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      customer: {
        findUnique: vi.fn().mockResolvedValue({
          dailySpendLimit: 5000000,
          deliveryProfile: { autonomousCheckoutEnabled: true, autonomousSpendCeiling: 2000000 },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      buyerIntent: {
        findFirst: vi.fn().mockResolvedValue({ id: 'intent-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      merchant: {
        findFirst: vi.fn().mockResolvedValue({ id: 'merch-demo-1' }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-log-2' }),
      },
    }

    mocks.transaction.mockImplementation(async (callback: (t: typeof tx) => Promise<unknown>) => {
      return callback(tx)
    })

    const result = await updateAutonomousSettings({
      enabled: false,
    })

    expect(result.success).toBe(true)
    expect(result.enabled).toBe(false)

    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: mockCustomer.id },
      data: {
        deliveryProfile: expect.objectContaining({
          autonomousCheckoutEnabled: false,
        }),
      },
    })

    expect(tx.buyerIntent.update).toHaveBeenCalledWith({
      where: { id: 'intent-1' },
      data: {
        autonomousPurchase: false,
        requiresConfirmation: true,
      },
    })
  })

  it('strictly rejects spend ceiling exceeding account daily spend limit', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      customer: {
        findUnique: vi.fn().mockResolvedValue({
          dailySpendLimit: 5000000, // ₹50,000
          deliveryProfile: {},
        }),
      },
    }

    mocks.transaction.mockImplementation(async (callback: (t: typeof tx) => Promise<unknown>) => {
      return callback(tx)
    })

    await expect(
      updateAutonomousSettings({
        enabled: true,
        spendCeilingPaise: 6000000, // ₹60,000 > ₹50,000
      })
    ).rejects.toThrow(/cannot exceed the daily spend limit/)
  })

  it('strictly rejects per-order spend limit exceeding the autonomous spend ceiling', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      customer: {
        findUnique: vi.fn().mockResolvedValue({
          dailySpendLimit: 5000000, // ₹50,000
          deliveryProfile: {},
        }),
      },
    }

    mocks.transaction.mockImplementation(async (callback: (t: typeof tx) => Promise<unknown>) => {
      return callback(tx)
    })

    await expect(
      updateAutonomousSettings({
        enabled: true,
        spendCeilingPaise: 2000000, // ₹20,000
        maxOrderSpendLimitPaise: 2500000, // ₹25,000 > ₹20,000
      })
    ).rejects.toThrow(/cannot exceed the autonomous spend ceiling/)
  })
})

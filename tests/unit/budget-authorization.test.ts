import { describe, it, expect, vi, beforeEach } from 'vitest'
import { assertAccountSpendLimit, updateCustomerSpendLimits } from '@/backend/actions/accountBudget'
import { authorizeCustomerBudgetUpdate, parseBuyerIntent } from '@/backend/actions/intent'

const mocks = vi.hoisted(() => ({
  generateObjectMock: vi.fn(),
  prismaMock: {
    $transaction: vi.fn(),
    customer: {
      findUnique: vi.fn(),
    },
    buyerIntent: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    generateObject: mocks.generateObjectMock,
  }
})

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    $transaction: vi.fn((cb: (tx: typeof mocks.prismaMock) => unknown) => cb(mocks.prismaMock)),
    customer: mocks.prismaMock.customer,
    buyerIntent: mocks.prismaMock.buyerIntent,
    auditLog: mocks.prismaMock.auditLog,
  },
}))

const prismaMock = mocks.prismaMock

describe('Deterministic First-Class Budget Authorization & Safety', () => {
  const CUSTOMER_ID = 'cust_test_uuid_123'
  const MERCHANT_ID = 'merch_test_uuid_456'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Per-Order Spending Hard Limit (assertAccountSpendLimit)', () => {
    it('blocks checkout if order amount exceeds customer maxOrderSpendLimit in deliveryProfile', async () => {
      const mockTx = {
        $executeRaw: vi.fn(),
        customer: {
          findUnique: vi.fn().mockResolvedValue({
            dailySpendLimit: 5000000,
            monthlySpendLimit: 20000000,
            deliveryProfile: { maxOrderSpendLimit: 500000 }, // ₹5,000 hard per-order cap
          }),
        },
        merchantPolicy: { findMany: vi.fn().mockResolvedValue([]) },
        order: {
          aggregate: vi.fn()
            .mockResolvedValueOnce({ _sum: { totalAmount: 100000 } })
            .mockResolvedValueOnce({ _sum: { totalAmount: 500000 } }),
          count: vi.fn().mockResolvedValue(1),
        },
      }

      // Order is ₹6,000 (600,000 paise), which exceeds the ₹5,000 per-order cap
      await expect(
        assertAccountSpendLimit(
          mockTx as unknown as Parameters<typeof assertAccountSpendLimit>[0],
          CUSTOMER_ID,
          MERCHANT_ID,
          600000
        )
      ).rejects.toThrow(/Order exceeds the customer-configured per-order limit of ₹5,000/)
    })

    it('permits checkout if order amount is within maxOrderSpendLimit and account limits', async () => {
      const mockTx = {
        $executeRaw: vi.fn(),
        customer: {
          findUnique: vi.fn().mockResolvedValue({
            dailySpendLimit: 5000000,
            monthlySpendLimit: 20000000,
            deliveryProfile: { maxOrderSpendLimit: 500000 }, // ₹5,000 hard per-order cap
          }),
        },
        merchantPolicy: { findMany: vi.fn().mockResolvedValue([]) },
        order: {
          aggregate: vi.fn()
            .mockResolvedValueOnce({ _sum: { totalAmount: 100000 } })
            .mockResolvedValueOnce({ _sum: { totalAmount: 500000 } }),
          count: vi.fn().mockResolvedValue(1),
        },
      }

      // Order is ₹4,500 (450,000 paise), which is within the ₹5,000 per-order cap
      const result = await assertAccountSpendLimit(
        mockTx as unknown as Parameters<typeof assertAccountSpendLimit>[0],
        CUSTOMER_ID,
        MERCHANT_ID,
        450000
      )

      expect(result.dailyCommitted).toBe(100000)
    })
  })

  describe('Customer Spend Limit Modification (updateCustomerSpendLimits)', () => {
    it('updates daily and per-order spend limits inside row-locked transaction', async () => {
      const mockCustomer = {
        id: CUSTOMER_ID,
        dailySpendLimit: 5000000,
        monthlySpendLimit: 20000000,
        deliveryProfile: { street: '123 Main St' },
      }

      const mockTx = {
        $executeRaw: vi.fn(),
        customer: {
          findUnique: vi.fn().mockResolvedValue(mockCustomer),
          update: vi.fn().mockImplementation(({ data }) => Promise.resolve({
            ...mockCustomer,
            ...data,
          })),
        },
      }

      const updated = await updateCustomerSpendLimits({
        tx: mockTx,
        customerId: CUSTOMER_ID,
        dailySpendLimit: 8000000,
        maxOrderSpendLimit: 750000,
      })

      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1)
      expect(mockTx.customer.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: CUSTOMER_ID },
        data: expect.objectContaining({
          dailySpendLimit: 8000000,
          deliveryProfile: expect.objectContaining({
            street: '123 Main St',
            maxOrderSpendLimit: 750000,
          }),
        }),
      }))
      expect(updated.dailySpendLimit).toBe(8000000)
    })

    it('rejects invalid non-positive or float spend limits', async () => {
      const mockTx = {
        $executeRaw: vi.fn(),
        customer: { findUnique: vi.fn() },
      }

      await expect(
        updateCustomerSpendLimits({
          tx: mockTx,
          customerId: CUSTOMER_ID,
          dailySpendLimit: -500,
        })
      ).rejects.toThrow('Daily spend limit must be a positive integer in paise.')

      await expect(
        updateCustomerSpendLimits({
          tx: mockTx,
          customerId: CUSTOMER_ID,
          maxOrderSpendLimit: 123.45,
        })
      ).rejects.toThrow('Per-order spend limit must be a positive integer in paise.')
    })
  })

  describe('Customer Budget Ceiling Authorization (authorizeCustomerBudgetUpdate)', () => {
    it('authoritatively sets a new budget ceiling and creates audit entry', async () => {
      prismaMock.customer.findUnique.mockResolvedValue({ dailySpendLimit: 5000000 })
      prismaMock.buyerIntent.findFirst.mockResolvedValue({
        id: 'intent_123',
        maximumAmount: 500000,
        requirements: { pendingBudgetIncrease: '800000' },
      })
      prismaMock.buyerIntent.update.mockResolvedValue({
        id: 'intent_123',
        maximumAmount: 800000,
      })

      const result = await authorizeCustomerBudgetUpdate({
        customerId: CUSTOMER_ID,
        actorUserId: 'user_123',
        budgetAmount: 800000,
      })

      expect(result.success).toBe(true)
      expect(result.maximumAmount).toBe(800000)
      expect(prismaMock.buyerIntent.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'intent_123' },
        data: expect.objectContaining({ maximumAmount: 800000 }),
      }))
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          action: 'CUSTOMER_BUDGET_CAP_MODIFIED',
          status: 'APPROVED',
          actorUserId: 'user_123',
        }),
      }))
    })

    it('rejects budget update exceeding customer daily spend limit', async () => {
      prismaMock.customer.findUnique.mockResolvedValue({ dailySpendLimit: 5000000 }) // Daily limit is ₹50,000

      // Attempting to set budget to ₹60,000 (6,000,000 paise)
      await expect(
        authorizeCustomerBudgetUpdate({
          customerId: CUSTOMER_ID,
          actorUserId: 'user_123',
          budgetAmount: 6000000,
        })
      ).rejects.toThrow(/Authorized budget cannot exceed the account daily spend limit/)
    })
  })

  describe('Conversational Intent Budget Invariants (parseBuyerIntent)', () => {
    it('retains active budget ceiling when prompt attempts to increase budget via chat', async () => {
      // Customer has active budget ceiling of ₹5,000 (500,000 paise)
      prismaMock.buyerIntent.findFirst.mockResolvedValue({
        id: 'intent_123',
        category: ['keyboard'],
        maximumAmount: 500000,
        requirements: {},
        updatedAt: new Date(),
      })
      prismaMock.buyerIntent.update.mockResolvedValue({
        id: 'intent_123',
        maximumAmount: 500000,
      })

      // Model structured output extracted a higher budget of ₹12,000 from conversational text
      mocks.generateObjectMock.mockResolvedValue({
        object: {
          isActionable: true,
          category: ['keyboard'],
          requirements: [{ key: 'switch', value: 'blue' }],
          maximumAmount: 12000, // ₹12,000
          clearBudget: false,
          intentAction: 'UPDATE',
        },
      })

      await parseBuyerIntent(CUSTOMER_ID, 'show me keyboards for 12000')

      // Verifies that maximumAmount remains locked at ₹5,000 (500,000 paise)
      expect(prismaMock.buyerIntent.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'intent_123' },
        data: expect.objectContaining({
          maximumAmount: 500000,
          requirements: expect.objectContaining({
            pendingBudgetIncrease: '1200000',
            budgetIncreaseRequiresAuthorization: 'true',
          }),
        }),
      }))
    })

    it('retains active budget ceiling when prompt attempts to clear budget via chat', async () => {
      prismaMock.buyerIntent.findFirst.mockResolvedValue({
        id: 'intent_123',
        category: ['keyboard'],
        maximumAmount: 500000,
        requirements: {},
        updatedAt: new Date(),
      })
      prismaMock.buyerIntent.update.mockResolvedValue({
        id: 'intent_123',
        maximumAmount: 500000,
      })

      // Model extracted clearBudget: true
      mocks.generateObjectMock.mockResolvedValue({
        object: {
          isActionable: true,
          category: ['keyboard'],
          requirements: [],
          maximumAmount: null,
          clearBudget: true,
          intentAction: 'UPDATE',
        },
      })

      await parseBuyerIntent(CUSTOMER_ID, 'I have no budget limit anymore')

      // Ceiling is retained, not cleared to null
      expect(prismaMock.buyerIntent.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'intent_123' },
        data: expect.objectContaining({
          maximumAmount: 500000,
          requirements: expect.objectContaining({
            pendingBudgetIncrease: 'UNLIMITED',
            budgetIncreaseRequiresAuthorization: 'true',
          }),
        }),
      }))
    })

    it('accepts narrowed or lower budget from conversational prompt', async () => {
      prismaMock.buyerIntent.findFirst.mockResolvedValue({
        id: 'intent_123',
        category: ['keyboard'],
        maximumAmount: 500000, // ₹5,000
        requirements: {},
        updatedAt: new Date(),
      })
      prismaMock.buyerIntent.update.mockResolvedValue({
        id: 'intent_123',
        maximumAmount: 300000, // ₹3,000
      })

      // Customer narrowed budget to ₹3,000
      mocks.generateObjectMock.mockResolvedValue({
        object: {
          isActionable: true,
          category: ['keyboard'],
          requirements: [],
          maximumAmount: 3000,
          clearBudget: false,
          intentAction: 'UPDATE',
        },
      })

      await parseBuyerIntent(CUSTOMER_ID, 'keep it under 3000 rupees')

      // Narrowed ceiling is accepted
      expect(prismaMock.buyerIntent.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'intent_123' },
        data: expect.objectContaining({
          maximumAmount: 300000,
        }),
      }))
    })
  })
})

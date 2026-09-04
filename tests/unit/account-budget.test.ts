import { describe, expect, test, vi } from 'vitest'
import { accountBudgetPeriods, assertAccountSpendLimit } from '@/backend/actions/accountBudget'

const CUSTOMER = 'd560ebdc-263c-4edb-82f7-f46b12ba5b65'

function budgetTx({ dailyLimit = 100_000, monthlyLimit = 500_000, sums = [20_000, 80_000] }: {
  dailyLimit?: number
  monthlyLimit?: number
  sums?: [number, number]
} = {}) {
  return {
    $executeRaw: vi.fn(),
    customer: { findUnique: vi.fn().mockResolvedValue({ dailySpendLimit: dailyLimit, monthlySpendLimit: monthlyLimit }) },
    order: {
      aggregate: vi.fn()
        .mockResolvedValueOnce({ _sum: { totalAmount: sums[0] } })
        .mockResolvedValueOnce({ _sum: { totalAmount: sums[1] } }),
      count: vi.fn().mockResolvedValue(0),
    },
  }
}

describe('durable buyer account spend policy', () => {
  test('uses stable UTC day and month boundaries', () => {
    const { dayStart, monthStart } = accountBudgetPeriods(new Date('2026-09-01T18:30:00.000Z'))
    expect(dayStart.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(monthStart.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  test('blocks an account daily limit using orders from every conversation and merchant', async () => {
    const tx = budgetTx({ dailyLimit: 100_000, sums: [80_000, 80_000] })
    await expect(assertAccountSpendLimit(tx, CUSTOMER, 'test-merchant', 25_000)).rejects.toThrow('daily spend limit')
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    expect(tx.order.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ customerId: CUSTOMER, status: { in: expect.arrayContaining(['PAYMENT_PENDING', 'PAID']) } }),
    }))
  })

  test('blocks the monthly limit even when the daily limit has room', async () => {
    const tx = budgetTx({ dailyLimit: 100_000, monthlyLimit: 100_000, sums: [20_000, 90_000] })
    await expect(assertAccountSpendLimit(tx, CUSTOMER, 'test-merchant', 20_000)).rejects.toThrow('monthly spend limit')
  })

  test('returns the committed balance when both durable limits permit checkout', async () => {
    const tx = budgetTx()
    await expect(assertAccountSpendLimit(tx, CUSTOMER, 'test-merchant', 30_000)).resolves.toMatchObject({
      dailyCommitted: 20_000,
      monthlyCommitted: 80_000,
      dailyLimit: 100_000,
      monthlyLimit: 500_000,
    })
    expect(tx.order.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        customerId: CUSTOMER,
        merchantId: 'test-merchant',
        OR: expect.arrayContaining([
          expect.objectContaining({ status: { in: ['PAID', 'PAYMENT_AUTHORIZED', 'PAYMENT_CAPTURED'] } }),
        ]),
      }),
    }))
  })

  test('blocks checkout when daily transaction count limit is exceeded', async () => {
    const tx = budgetTx()
    tx.order.count = vi.fn().mockResolvedValue(25)
    await expect(assertAccountSpendLimit(tx, CUSTOMER, 'test-merchant', 10_000)).rejects.toThrow('daily transaction count limit (25)')
  })
})


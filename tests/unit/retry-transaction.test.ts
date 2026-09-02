import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}))

import { withRetryTransaction } from '@/backend/db/retryTransaction'
import { beforeEach } from 'vitest'

describe('Automatic Database Transaction Conflict Retry Wrapper', () => {
  beforeEach(() => {
    mocks.transaction.mockReset()
  })

  it('executes successfully on the first attempt without retry', async () => {
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}))

    const result = await withRetryTransaction(async () => 'success', { maxRetries: 3 })
    expect(result).toBe('success')
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })

  it('retries on P2034 write conflict and returns result when subsequent attempt succeeds', async () => {
    let callCount = 0
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      callCount += 1
      if (callCount === 1) {
        const error = new Prisma.PrismaClientKnownRequestError('Write conflict', {
          code: 'P2034',
          clientVersion: '7.10.0',
        })
        throw error
      }
      return fn({})
    })

    const result = await withRetryTransaction(async () => 'recovered_after_conflict', {
      maxRetries: 3,
      baseDelayMs: 1,
    })

    expect(result).toBe('recovered_after_conflict')
    expect(callCount).toBe(2)
  })

  it('throws error if retry attempts exceed maxRetries', async () => {
    mocks.transaction.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError('Persistent conflict', {
        code: 'P2034',
        clientVersion: '7.10.0',
      })
    })

    await expect(
      withRetryTransaction(async () => 'fail', { maxRetries: 2, baseDelayMs: 1 })
    ).rejects.toThrow('Persistent conflict')

    expect(mocks.transaction).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })
})

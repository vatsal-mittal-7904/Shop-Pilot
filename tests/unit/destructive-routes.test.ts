import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireCustomer: vi.fn(),
  requireMerchant: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/backend/auth/session', () => ({
  requireCustomer: mocks.requireCustomer,
  requireMerchant: mocks.requireMerchant,
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: { $transaction: mocks.transaction },
}))

import { POST as clearChat } from '@/app/api/chat/clear/route'
import { POST as cleanCampaigns } from '@/app/api/clean/route'

describe('destructive maintenance routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  test('rejects an unauthenticated chat-history clear before database access', async () => {
    mocks.requireCustomer.mockRejectedValue(new Error('Unauthorized customer access'))

    const response = await clearChat()

    expect(response.status).toBe(401)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  test('clears only the caller’s conversation messages and preserves financial records', async () => {
    mocks.requireCustomer.mockResolvedValue({
      user: { id: 'user-1' },
      customer: { id: 'customer-1' },
    })

    const tx = {
      conversation: {
        findMany: vi.fn().mockResolvedValue([{ id: 'conversation-1', merchantId: 'merchant-1' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }
    mocks.transaction.mockImplementation(async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx))

    const response = await clearChat()

    expect(response.status).toBe(200)
    expect(tx.conversation.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'customer-1' },
      data: { messages: [] },
    })
    expect(tx.auditLog.createMany).toHaveBeenCalledTimes(1)
  })

  test('rejects anonymous campaign cleanup before database access', async () => {
    mocks.requireMerchant.mockRejectedValue(new Error('Unauthorized merchant access'))

    const response = await cleanCampaigns()

    expect(response.status).toBe(401)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

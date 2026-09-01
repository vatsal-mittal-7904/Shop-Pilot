import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireCustomer: vi.fn(),
  conversationFindFirst: vi.fn(),
  agentActionFindMany: vi.fn(),
}))

vi.mock('@/backend/auth/session', () => ({
  requireCustomer: mocks.requireCustomer,
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    conversation: { findFirst: mocks.conversationFindFirst },
    agentAction: { findMany: mocks.agentActionFindMany },
  },
}))

import { getRecentAgentActions } from '@/backend/actions/explainability'

describe('Explainability & Agent Action Auditing', () => {
  const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111'
  const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222'
  const MERCHANT_ID = '33333333-3333-4333-8333-333333333333'

  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireCustomer.mockResolvedValue({
      user: { id: 'usr-1', email: 'cust@test.com' },
      customer: { id: CUSTOMER_ID },
    })
  })

  it('rejects invalid UUID conversation IDs with schema validation error', async () => {
    await expect(getRecentAgentActions('invalid-uuid')).rejects.toThrow()
    expect(mocks.conversationFindFirst).not.toHaveBeenCalled()
  })

  it('throws error when conversation is not owned by the authenticated customer', async () => {
    mocks.conversationFindFirst.mockResolvedValue(null)

    await expect(getRecentAgentActions(CONVERSATION_ID)).rejects.toThrow('Conversation not found')
    expect(mocks.conversationFindFirst).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID, customerId: CUSTOMER_ID },
      select: { id: true, merchantId: true },
    })
  })

  it('returns DISCOUNT_OFFER and BUNDLE_ADDON_OFFER actions scoped to customer conversation', async () => {
    mocks.conversationFindFirst.mockResolvedValue({
      id: CONVERSATION_ID,
      merchantId: MERCHANT_ID,
    })

    const sampleActions = [
      {
        id: 'act-1',
        type: 'DISCOUNT_OFFER',
        status: 'ALLOWED',
        policyResult: { checked: true, passed: true, limit: 15, requested: 10, reason: 'Within policy' },
      },
      {
        id: 'act-2',
        type: 'BUNDLE_ADDON_OFFER',
        status: 'BLOCKED',
        policyResult: { checked: true, passed: false, limit: 15, requested: 25, reason: 'Exceeds policy ceiling' },
      },
    ]

    mocks.agentActionFindMany.mockResolvedValue(sampleActions)

    const result = await getRecentAgentActions(CONVERSATION_ID)
    expect(result).toEqual(sampleActions)
    expect(mocks.agentActionFindMany).toHaveBeenCalledWith({
      where: {
        merchantId: MERCHANT_ID,
        conversationId: CONVERSATION_ID,
        type: { in: ['DISCOUNT_OFFER', 'BUNDLE_ADDON_OFFER'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        type: true,
        status: true,
        policyResult: true,
      },
    })
  })
})

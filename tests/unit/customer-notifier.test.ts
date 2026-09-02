import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { notifyCustomerOfDLQ } from '@/backend/notifications/customerNotifier'
import { prisma } from '@/backend/db/prisma'

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    order: {
      findUnique: vi.fn(),
    },
    conversationMessage: {
      create: vi.fn(),
    },
  },
}))

describe('Customer Notifier (notifyCustomerOfDLQ)', () => {
  let consoleLogSpy: any

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.clearAllMocks()
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
  })

  it('silently returns if order is not found', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(null)

    await notifyCustomerOfDLQ({ refundId: 'ref_123', orderId: 'ord_123', reason: 'timeout' })

    expect(prisma.order.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ord_123' } }))
    expect(console.log).not.toHaveBeenCalled()
    expect(prisma.conversationMessage.create).not.toHaveBeenCalled()
  })

  it('dispatches email but no system message if customer has no active conversations', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
      id: 'ord_123',
      customer: {
        user: { email: 'test@example.com', name: 'John Doe' },
        conversations: [], // No conversations
      },
    } as any)

    await notifyCustomerOfDLQ({ refundId: 'ref_123', orderId: 'ord_123', reason: 'timeout' })

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Dispatching DLQ email to test@example.com:'))
    expect(prisma.conversationMessage.create).not.toHaveBeenCalled()
  })

  it('dispatches email AND injects a system message if customer has an active conversation', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
      id: 'ord_123',
      customer: {
        user: { email: 'test@example.com', name: 'John Doe' },
        conversations: [{ id: 'conv_456' }],
      },
    } as any)

    await notifyCustomerOfDLQ({ refundId: 'ref_123', orderId: 'ord_123', reason: 'timeout' })

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Dispatching DLQ email to test@example.com:'))
    expect(prisma.conversationMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          conversationId: 'conv_456',
          role: 'system',
          content: expect.stringContaining('We encountered a technical issue processing your automated refund for Order ord_123'),
        },
      })
    )
  })
})

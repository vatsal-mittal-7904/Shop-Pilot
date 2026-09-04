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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
     
     
    } as unknown as string)

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
    } as unknown as string)

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

  it('dispatches real transactional email via Resend API when RESEND_API_KEY is configured', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
      id: 'ord_resend',
      customer: {
        user: { email: 'vip@example.com', name: 'Alice Smith' },
        conversations: [{ id: 'conv_resend' }],
      },
    } as unknown as string)

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
    })

    const result = await notifyCustomerOfDLQ(
      { refundId: 'ref_resend', orderId: 'ord_resend' },
      {
        resendApiKey: 're_123456789',
        fetchImpl: mockFetch as unknown as typeof fetch,
      }
    )

    expect(result).toEqual({
      emailDispatched: true,
      inAppDispatched: true,
      transport: 'resend',
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers['Authorization']).toBe('Bearer re_123456789')
    const parsedBody = JSON.parse(init.body)
    expect(parsedBody.to).toEqual(['vip@example.com'])
    expect(parsedBody.subject).toContain('Important Update Regarding Your Refund')
  })

  it('dispatches signed customer alert webhook when CUSTOMER_NOTIFICATION_WEBHOOK_URL is configured', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
      id: 'ord_hook',
      customer: {
        user: { email: 'webhook.buyer@example.com', name: 'Bob' },
        conversations: [],
      },
    } as unknown as string)

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
    })

    const result = await notifyCustomerOfDLQ(
      { refundId: 'ref_hook', orderId: 'ord_hook' },
      {
        webhookUrl: 'https://crm.example.com/alerts',
        webhookSecret: 'hook-secret-xyz',
        fetchImpl: mockFetch as unknown as typeof fetch,
      }
    )

    expect(result).toEqual({
      emailDispatched: true,
      inAppDispatched: false,
      transport: 'webhook',
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://crm.example.com/alerts')
    expect(init.headers['x-customer-alert-signature']).toBeDefined()
    const parsedBody = JSON.parse(init.body)
    expect(parsedBody.event).toBe('CUSTOMER_REFUND_DLQ_ALERT')
    expect(parsedBody.recipientEmail).toBe('webhook.buyer@example.com')
  })
})


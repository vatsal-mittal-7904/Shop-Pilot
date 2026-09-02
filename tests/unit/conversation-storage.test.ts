import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  messageCreateMany: vi.fn(),
  conversationFindUnique: vi.fn(),
  conversationUpdate: vi.fn(),
  messageFindMany: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    conversationMessage: {
      createMany: mocks.messageCreateMany,
      findMany: mocks.messageFindMany,
    },
    conversation: {
      findUnique: mocks.conversationFindUnique,
      update: mocks.conversationUpdate,
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        conversationMessage: {
          createMany: mocks.messageCreateMany,
          findMany: mocks.messageFindMany,
        },
        conversation: {
          findUnique: mocks.conversationFindUnique,
          update: mocks.conversationUpdate,
        },
      }),
  },
}))

import {
  persistConversationMessages,
  getConversationHistory,
  MAX_CONVERSATION_WINDOW_MESSAGES,
} from '@/backend/ai/conversationStorage'

describe('Scalable Conversation Storage & Sliding Window Manager', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  test('persists incoming messages to normalized ConversationMessage table', async () => {
    mocks.conversationFindUnique.mockResolvedValue({ id: 'c1', messages: [] })
    mocks.conversationUpdate.mockResolvedValue({})
    mocks.messageFindMany.mockResolvedValue([
      { id: 'm1', role: 'user', content: 'Hello', createdAt: new Date() },
    ])

    const result = await persistConversationMessages('c1', [
      { role: 'user', content: 'Hello' },
    ])

    expect(mocks.messageCreateMany).toHaveBeenCalledWith({
      data: [
        {
          conversationId: 'c1',
          role: 'user',
          content: 'Hello',
        },
      ],
    })
    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({
        updatedAt: expect.any(Date),
      }),
    })
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
  })

  test('retrieves normalized message history with sliding window', async () => {
    const mockMessages = Array.from({ length: 40 }).map((_, i) => ({
      id: `msg_${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
      createdAt: new Date(Date.now() - (40 - i) * 1000),
    }))

    // Return the latest 30 descending
    mocks.messageFindMany.mockResolvedValue([...mockMessages].reverse().slice(0, MAX_CONVERSATION_WINDOW_MESSAGES))

    const history = await getConversationHistory('c1', MAX_CONVERSATION_WINDOW_MESSAGES)

    expect(mocks.messageFindMany).toHaveBeenCalledWith({
      where: { conversationId: 'c1' },
      orderBy: { createdAt: 'desc' },
      take: MAX_CONVERSATION_WINDOW_MESSAGES,
      select: { id: true, role: true, content: true, createdAt: true },
    })

    expect(history).toHaveLength(MAX_CONVERSATION_WINDOW_MESSAGES)
    // Oldest among the window comes first after reverse
    expect(history[0].id).toBe('msg_10')
  })

  test('gracefully falls back to legacy Conversation.messages JSON if normalized records are empty', async () => {
    mocks.messageFindMany.mockResolvedValue([])
    mocks.conversationFindUnique.mockResolvedValue({
      id: 'c1',
      messages: [
        { role: 'user', content: 'Legacy Turn 1' },
        { role: 'assistant', content: 'Legacy Turn 2' },
      ],
    })

    const history = await getConversationHistory('c1')

    expect(history).toHaveLength(2)
    expect(history[0].content).toBe('Legacy Turn 1')
    expect(history[1].content).toBe('Legacy Turn 2')
  })
})

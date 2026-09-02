/**
 * Scalable Conversation History Storage & Sliding-Window Retrieval Manager
 *
 * Provides normalized, high-performance message persistence and sliding-window
 * queries for multi-turn LLM agent conversations.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/backend/db/prisma'

export interface StoredMessage {
  id?: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | Record<string, unknown> | Array<Record<string, unknown>>
  createdAt?: Date | string
}

export const MAX_CONVERSATION_WINDOW_MESSAGES = 30

/**
 * Appends new turn messages to the normalized ConversationMessage table
 * in an atomic transaction while maintaining Conversation.updatedAt.
 */
export async function persistConversationMessages(
  conversationId: string,
  incomingMessages: StoredMessage[]
): Promise<StoredMessage[]> {
  if (!incomingMessages || incomingMessages.length === 0) {
    return getConversationHistory(conversationId)
  }

  return prisma.$transaction(async (tx) => {
    // 1. Insert into normalized table
    await tx.conversationMessage.createMany({
      data: incomingMessages.map((msg) => ({
        conversationId,
        role: msg.role,
        content: msg.content as Prisma.InputJsonValue,
      })),
    })

    // 2. Refresh Conversation timestamp and legacy array fallback
    const legacyConversation = await tx.conversation.findUnique({
      where: { id: conversationId },
      select: { messages: true },
    })
    const existingLegacy = Array.isArray(legacyConversation?.messages)
      ? (legacyConversation.messages as unknown as StoredMessage[])
      : []
    const updatedLegacy = [...existingLegacy, ...incomingMessages]

    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        updatedAt: new Date(),
        messages: updatedLegacy as unknown as Prisma.InputJsonValue,
      },
    })

    // 3. Return updated sliding-window history
    const recentMessages = await tx.conversationMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: MAX_CONVERSATION_WINDOW_MESSAGES,
      select: { id: true, role: true, content: true, createdAt: true },
    })

    return (recentMessages.reverse() as unknown as StoredMessage[])
  })
}

/**
 * Retrieves the conversation history with a configurable sliding-window limit.
 * Gracefully falls back to the legacy JSON blob if normalized rows have not been created yet.
 */
export async function getConversationHistory(
  conversationId: string,
  maxMessages = MAX_CONVERSATION_WINDOW_MESSAGES
): Promise<StoredMessage[]> {
  // 1. Try normalized messages first
  const normalized = await prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: maxMessages,
    select: { id: true, role: true, content: true, createdAt: true },
  })

  if (normalized.length > 0) {
    return (normalized.reverse() as unknown as StoredMessage[])
  }

  // 2. Fallback to legacy Conversation.messages JSON if normalized records are empty
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { messages: true },
  })

  if (conversation && Array.isArray(conversation.messages)) {
    const legacy = conversation.messages as unknown as StoredMessage[]
    return legacy.slice(-maxMessages)
  }

  return []
}

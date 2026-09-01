import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'

// This route intentionally clears only the caller's displayed chat history.
// Policy decisions, buyer intents, recommendations, orders, and audit records
// are financial evidence and must never be deleted by a convenience endpoint.
export async function POST() {
  let context: Awaited<ReturnType<typeof requireCustomer>>
  try {
    context = await requireCustomer()
  } catch {
    return Response.json({ error: 'Unauthorized customer access' }, { status: 401 })
  }

  const { user, customer } = context

  const clearedConversations = await prisma.$transaction(async (tx) => {
    const conversations = await tx.conversation.findMany({
      where: { customerId: customer.id },
      select: { id: true, merchantId: true },
    })

    if (conversations.length === 0) return 0

    await tx.conversation.updateMany({
      where: { customerId: customer.id },
      data: { messages: [] },
    })

    await tx.auditLog.createMany({
      data: [...new Set(conversations.map((conversation) => conversation.merchantId))].map((merchantId) => ({
        merchantId,
        actorUserId: user.id,
        action: 'CUSTOMER_CHAT_HISTORY_CLEARED',
        status: 'EXECUTED',
        reason: 'Customer cleared their own displayed conversation history.',
        details: { customerId: customer.id, clearedConversations: conversations.filter((conversation) => conversation.merchantId === merchantId).length },
      })),
    })

    return conversations.length
  })

  return Response.json({ success: true, clearedConversations })
}

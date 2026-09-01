import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'

// This route soft-archives the caller's active conversation sessions.
// The raw message transcript, tool executions, and LLM reasoning steps
// remain preserved in the database for audits and forensic investigations,
// while marking clearedAt so subsequent chat interactions start fresh.
export async function POST() {
  let context: Awaited<ReturnType<typeof requireCustomer>>
  try {
    context = await requireCustomer()
  } catch {
    return Response.json({ error: 'Unauthorized customer access' }, { status: 401 })
  }

  const { user, customer } = context

  const clearedConversations = await prisma.$transaction(async (tx) => {
    const activeConversations = await tx.conversation.findMany({
      where: { customerId: customer.id, clearedAt: null },
      select: { id: true, merchantId: true },
    })

    if (activeConversations.length === 0) return 0

    const now = new Date()
    await tx.conversation.updateMany({
      where: { customerId: customer.id, clearedAt: null },
      data: { clearedAt: now },
    })

    await tx.auditLog.createMany({
      data: [...new Set(activeConversations.map((conversation) => conversation.merchantId))].map((merchantId) => ({
        merchantId,
        actorUserId: user.id,
        action: 'CUSTOMER_CHAT_HISTORY_CLEARED',
        status: 'EXECUTED',
        reason: 'Customer soft-archived their displayed conversation history. Granular transcripts preserved.',
        details: {
          customerId: customer.id,
          clearedConversations: activeConversations.filter((conversation) => conversation.merchantId === merchantId).length,
          clearedAt: now.toISOString(),
        },
      })),
    })

    return activeConversations.length
  })

  return Response.json({ success: true, clearedConversations })
}

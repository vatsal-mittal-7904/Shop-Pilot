import { prisma } from '@/backend/db/prisma'

/**
 * Dispatches a notification to the customer when a background job (like a refund)
 * enters the Dead Letter Queue (DLQ) and requires manual intervention.
 * This prevents the customer from thinking they were scammed when an automated process fails.
 */
export async function notifyCustomerOfDLQ({
  refundId,
  orderId,
  reason
}: {
  refundId: string
  orderId: string
  reason: string
}) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: {
        include: {
          user: true,
          conversations: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      }
    }
  })

  if (!order) return

  const email = order.customer.user.email
  const customerName = order.customer.user.name ?? 'Customer'

  // 1. Simulate dispatching a transactional email
  console.log(`[CUSTOMER_NOTIFIER] Dispatching DLQ email to ${email}:`)
  console.log(`Subject: Important Update Regarding Your Refund (Order: ${orderId})`)
  console.log(`Body: Hi ${customerName}, we encountered a technical issue automatically processing your refund (${refundId}).`)
  console.log(`Our finance team has been alerted and will process it manually within 24 hours.`)

  // 2. Insert a system message into the customer's active chat context so they see it
  const activeConversation = order.customer.conversations[0]
  if (activeConversation) {
    await prisma.conversationMessage.create({
      data: {
        conversationId: activeConversation.id,
        role: 'system',
        content: `System Alert: We encountered a technical issue processing your automated refund for Order ${orderId}. Our team has been alerted and is processing it manually. Reference ID: ${refundId}.`,
      }
    })
  }
}

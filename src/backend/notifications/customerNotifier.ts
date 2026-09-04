import { prisma } from '@/backend/db/prisma'
import crypto from 'crypto'

export interface CustomerNotificationOptions {
  resendApiKey?: string
  webhookUrl?: string
  webhookSecret?: string
  fromEmail?: string
  fetchImpl?: typeof fetch
}

export interface CustomerDLQNotificationResult {
  emailDispatched: boolean
  inAppDispatched: boolean
  transport: 'resend' | 'webhook' | 'demo_fallback'
}

/**
 * Dispatches a notification to the customer when a background job (like a refund)
 * enters the Dead Letter Queue (DLQ) and requires manual intervention.
 *
 * Multi-Channel Delivery Architecture:
 * 1. Pluggable Transactional Transport:
 *    - Native Resend API (HTTP POST to https://api.resend.com/emails via fetch) if RESEND_API_KEY is configured.
 *    - HMAC-signed Webhook (HTTP POST with X-Customer-Alert-Signature) if CUSTOMER_NOTIFICATION_WEBHOOK_URL is configured.
 *    - Development/Demo fallback to console logging when no external email credentials are set.
 * 2. In-App Context Persistence:
 *    - Durably creates an immutable system ConversationMessage in PostgreSQL so the customer immediately sees the status in their session.
 */
export async function notifyCustomerOfDLQ(
  {
    refundId,
    orderId,
    reason,
  }: {
    refundId: string
    orderId: string
    reason?: string
  },
  options?: CustomerNotificationOptions
): Promise<CustomerDLQNotificationResult | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: {
        include: {
          user: true,
          conversations: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  })

  if (!order) return null

  const email = order.customer.user.email
  const customerName = order.customer.user.name ?? 'Customer'
  const subject = `Important Update Regarding Your Refund (Order: ${orderId})`
  const textBody = `Hi ${customerName},\n\nWe encountered a technical issue automatically processing your refund (${refundId}).\nOur finance team has been alerted and will process it manually within 24 hours.\nReference: ${refundId}${reason ? `\nReason: ${reason}` : ''}`

  const fetchFn = options?.fetchImpl ?? fetch
  const resendApiKey = options?.resendApiKey ?? process.env.RESEND_API_KEY
  const webhookUrl = options?.webhookUrl ?? process.env.CUSTOMER_NOTIFICATION_WEBHOOK_URL
  const webhookSecret =
    options?.webhookSecret ??
    process.env.CUSTOMER_NOTIFICATION_WEBHOOK_SECRET ??
    process.env.ALERT_WEBHOOK_SECRET
  const fromEmail = options?.fromEmail ?? process.env.NOTIFICATION_FROM_EMAIL ?? 'support@technest.com'

  let transport: 'resend' | 'webhook' | 'demo_fallback' = 'demo_fallback'
  let emailDispatched = false

  // 1. Pluggable Transactional Transport
  if (resendApiKey) {
    try {
      const res = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [email],
          subject,
          text: textBody,
        }),
      })
      if (res.ok) {
        transport = 'resend'
        emailDispatched = true
        console.log(`[CUSTOMER_NOTIFIER:RESEND] Dispatched transactional email to ${email} (Order: ${orderId})`)
      } else {
        console.error(`[CUSTOMER_NOTIFIER:RESEND_ERROR] Resend returned HTTP ${res.status}`)
      }
    } catch (err) {
      console.error('[CUSTOMER_NOTIFIER:RESEND_EXCEPTION]', err)
    }
  } else if (webhookUrl) {
    try {
      const payload = {
        event: 'CUSTOMER_REFUND_DLQ_ALERT',
        recipientEmail: email,
        customerName,
        orderId,
        refundId,
        subject,
        body: textBody,
        timestamp: new Date().toISOString(),
      }
      const rawBody = JSON.stringify(payload)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (webhookSecret) {
        headers['x-customer-alert-signature'] = crypto
          .createHmac('sha256', webhookSecret)
          .update(rawBody)
          .digest('hex')
      }
      const res = await fetchFn(webhookUrl, {
        method: 'POST',
        headers,
        body: rawBody,
      })
      if (res.ok) {
        transport = 'webhook'
        emailDispatched = true
        console.log(`[CUSTOMER_NOTIFIER:WEBHOOK] Dispatched customer alert webhook to ${webhookUrl} for ${email}`)
      } else {
        console.error(`[CUSTOMER_NOTIFIER:WEBHOOK_ERROR] Webhook returned HTTP ${res.status}`)
      }
    } catch (err) {
      console.error('[CUSTOMER_NOTIFIER:WEBHOOK_EXCEPTION]', err)
    }
  }

  // If no external provider configured or provider call failed, log clear demo fallback
  if (!emailDispatched) {
    console.log(`[CUSTOMER_NOTIFIER] Dispatching DLQ email to ${email}:`)
    console.log(`Subject: ${subject}`)
    console.log(`Body: Hi ${customerName}, we encountered a technical issue automatically processing your refund (${refundId}).`)
    console.log(`Our finance team has been alerted and will process it manually within 24 hours.`)
  }

  // 2. Insert a system message into the customer's active chat context so they see it
  let inAppDispatched = false
  const activeConversation = order.customer.conversations[0]
  if (activeConversation) {
    await prisma.conversationMessage.create({
      data: {
        conversationId: activeConversation.id,
        role: 'system',
        content: `System Alert: We encountered a technical issue processing your automated refund for Order ${orderId}. Our team has been alerted and is processing it manually. Reference ID: ${refundId}.`,
      },
    })
    inAppDispatched = true
  }

  return {
    emailDispatched,
    inAppDispatched,
    transport,
  }
}


import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/backend/db/prisma'

// Deliberately NOT a `'use server'` module, unlike its siblings in this
// directory. This function trusts that the caller has already verified the
// Razorpay webhook signature (X-Razorpay-Signature) before invoking it --
// exposing it as a client-callable server action would let any browser
// fabricate a fake "payment.captured" payload and mark arbitrary orders as
// paid, with no signature check in the path at all. Server-side webhook
// route handlers only.

const paymentEntitySchema = z
  .object({
    id: z.string().min(1), // Razorpay payment id, e.g. "pay_xxx"
    order_id: z.string().min(1), // Razorpay order id, e.g. "order_xxx"
    // amount/currency are required so the tampering check below fails closed:
    // a payment entity that omits them is rejected rather than trusted.
    amount: z.number().int().nonnegative(),
    currency: z.string().min(1),
    error_description: z.string().nullish(),
  })
  .passthrough()

// The shape this function expects. Razorpay's actual webhook body nests
// entities under `payload.payment.entity` / `payload.order.entity`; the
// per-delivery idempotency key ships as the X-Razorpay-Event-Id HTTP header,
// not in the JSON body, so the calling webhook route is expected to merge it
// in as `razorpayEventId` before calling this function.
const webhookPayloadSchema = z
  .object({
    razorpayEventId: z.string().min(1),
    event: z.string().min(1),
    payload: z
      .object({
        payment: z
          .object({
            entity: paymentEntitySchema,
          })
          .optional(),
      })
      .passthrough(),
  })
  .passthrough()

// Both of these mean "the customer's money is committed". Razorpay lets the
// dashboard subscribe to either or both, and a webhook configured to send only
// `order.paid` is a legitimate setup -- handling just `payment.captured` would
// leave those orders permanently un-paid while still marking the event
// processed, so they would never be retried. `order.paid` carries a
// payload.payment.entity alongside payload.order.entity, so the order
// resolution below works for both without a second lookup path.
const PAID_EVENTS = new Set(['payment.captured', 'order.paid'])

/**
 * Applies a single verified Razorpay webhook delivery to our Order/Payment
 * state. Everything below -- the WebhookEvent record, any state mutation,
 * and the processedAt finalization -- happens in one Prisma transaction:
 * either the whole delivery is applied, or none of it is.
 */
export async function processRazorpayEvent(payload: unknown) {
  const parsed = webhookPayloadSchema.parse(payload)
  const razorpayEventId = parsed.razorpayEventId
  const eventType = parsed.event
  const paymentEntity = parsed.payload.payment?.entity
  const razorpayOrderId = paymentEntity?.order_id

  return prisma.$transaction(async (tx) => {
    // Idempotency: Razorpay redelivers webhooks on anything but a prompt 2xx,
    // and razorpayEventId is unique. Because this whole function is one
    // transaction, a WebhookEvent row only ever persists once processedAt is
    // set on the same commit -- so an existing row here always means "fully
    // processed already". Short-circuit rather than re-running mutations or
    // re-writing audit history for a duplicate delivery.
    const existing = await tx.webhookEvent.findUnique({ where: { razorpayEventId } })
    if (existing?.processedAt) {
      return existing
    }

    // Resolve the Order this event is about. Both event types this function
    // acts on carry a Razorpay order id via payload.payment.entity.order_id.
    // `items` is included because marking an order paid is also what commits
    // the stock (see the decrement below).
    const order = razorpayOrderId
      ? await tx.order.findUnique({
          where: { razorpayOrderId },
          include: { payment: true, items: true },
        })
      : null

    if (!order) {
      // Every eventType this function handles mutates an Order, so failing
      // to resolve one is a hard error, not a silent no-op -- and since this
      // is inside the transaction, throwing here also rolls back the
      // WebhookEvent insert below rather than leaving an orphaned row.
      // Razorpay will retry the delivery on the resulting non-2xx response.
      throw new Error(
        `No Order found for Razorpay order ${razorpayOrderId ?? '(missing order_id)'} -- webhook event ${razorpayEventId} (${eventType}) could not be applied`,
      )
    }

    // A genuinely-signed event still has to be about the amount we actually
    // billed. Without this, a valid webhook for a different (or tampered)
    // amount would mark the order paid for the wrong sum -- the signature
    // proves the message came from Razorpay, not that it matches our order.
    // Fails closed: a mismatch throws and Razorpay retries.
    if (paymentEntity && (paymentEntity.amount !== order.totalAmount || paymentEntity.currency !== order.currency)) {
      throw new Error(
        `Webhook payment amount/currency (${paymentEntity.amount} ${paymentEntity.currency}) does not match order ${order.id} (${order.totalAmount} ${order.currency})`,
      )
    }

    // 1. Initial record.
    const webhookEvent =
      existing ??
      (await tx.webhookEvent.create({
        data: {
          razorpayEventId,
          eventType,
          payload: payload as Prisma.InputJsonValue,
          orderId: order.id,
        },
      }))

    // 2. State mutations based on eventType.
    if (PAID_EVENTS.has(eventType)) {
      if (!order.payment) {
        throw new Error(`Order ${order.id} has no Payment row to update for webhook event ${razorpayEventId}`)
      }
      const razorpayPaymentId = paymentEntity?.id
      if (!razorpayPaymentId) {
        throw new Error(`${eventType} event ${razorpayEventId} is missing payload.payment.entity.id`)
      }

      if (order.status !== 'PAID') {
        let inventoryAvailable = true
        for (const item of order.items) {
          const product = await tx.product.findUnique({ where: { id: item.productId } })
          if (!product || product.inventory < item.quantity) {
            inventoryAvailable = false
            break
          }
        }

        if (inventoryAvailable) {
          for (const item of order.items) {
            const result = await tx.product.updateMany({
              where: { id: item.productId, inventory: { gte: item.quantity } },
              data: { inventory: { decrement: item.quantity } },
            })
            if (result.count !== 1) {
              throw new Error(
                `Inventory became unavailable for product ${item.productId} while processing webhook event ${razorpayEventId}`,
              )
            }
          }

          await tx.payment.update({
            where: { id: order.payment.id },
            data: { status: 'CAPTURED', razorpayPaymentId },
          })
          await tx.order.update({
            where: { id: order.id },
            data: { status: 'PAID', razorpayPaymentId },
          })
          
          if (order.offerId) {
            await tx.merchant.update({
              where: { id: order.merchantId },
              data: { aiRecoveredRevenue: { increment: order.totalAmount } }
            })
          }
          await tx.auditLog.create({
            data: {
              merchantId: order.merchantId,
              orderId: order.id,
              action: 'PAYMENT_CAPTURED',
              status: 'EXECUTED',
              reason: 'Razorpay confirmed payment capture; stock committed once',
              details: { razorpayEventId, razorpayPaymentId, razorpayOrderId, eventType } as Prisma.InputJsonValue,
            },
          })
        } else {
          await tx.order.update({
            where: { id: order.id },
            data: { status: 'INVENTORY_FAILED', razorpayPaymentId },
          })
          await tx.payment.update({
            where: { id: order.payment.id },
            data: { status: 'FAILED', razorpayPaymentId },
          })
          await tx.auditLog.create({
            data: {
              merchantId: order.merchantId,
              orderId: order.id,
              action: 'PAYMENT_CAPTURED',
              status: 'FAILED',
              reason: 'Payment captured but inventory sold out. Automated refund issued.',
              details: { razorpayEventId, razorpayPaymentId, razorpayOrderId, eventType } as Prisma.InputJsonValue,
            },
          })
          
                    // Execute refund INSIDE the transaction so that if it fails, the transaction rolls back
          // and Razorpay's webhook retry mechanism will attempt it again.
          const { razorpay } = await import('@/backend/services/razorpay')
          try {
            await razorpay.payments.refund(razorpayPaymentId, {
              amount: order.totalAmount,
              notes: { reason: 'Inventory unavailable at time of capture' }
            })
          } catch (error: any) {
            // If Razorpay says it's already refunded, this is likely a retry after a previous 
            // successful refund where the DB commit failed. We can safely ignore it and proceed
            // to commit the INVENTORY_FAILED state.
            const isAlreadyRefunded = error?.statusCode === 400 && error?.error?.description?.includes('already been fully refunded')
            if (!isAlreadyRefunded) {
              // Any other error (network, rate limit, etc) MUST throw to roll back the transaction
              // and return 500, so Razorpay will retry the webhook.
              throw new Error(`Failed to refund payment ${razorpayPaymentId}: ${error?.message || 'Unknown error'}`)
            }
          }
        }
      }
    } else if (eventType === 'payment.failed') {
      if (!order.payment) {
        throw new Error(`Order ${order.id} has no Payment row to update for webhook event ${razorpayEventId}`)
      }

      // Never walk a paid order backwards. A late or redelivered failure event
      // for an order that already captured must not flip it to PAYMENT_FAILED
      // (and must not strand the stock we already committed).
      if (order.status !== 'PAID') {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'PAYMENT_FAILED' },
        })
        await tx.payment.update({
          where: { id: order.payment.id },
          data: { status: 'FAILED' },
        })
        await tx.auditLog.create({
          data: {
            merchantId: order.merchantId,
            orderId: order.id,
            action: 'PAYMENT_FAILED',
            status: 'FAILED',
            reason: paymentEntity?.error_description ?? 'Razorpay reported payment failure',
            details: { razorpayEventId, razorpayOrderId } as Prisma.InputJsonValue,
          },
        })
      }
    }
    // Any other eventType: the WebhookEvent row above still records receipt
    // with no state mutation, and is marked processed below so a duplicate
    // redelivery of an event type we don't act on doesn't reprocess forever.

    // 3. Finalize.
    return tx.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { processedAt: new Date() },
    })
  }, { isolationLevel: 'Serializable' })
}

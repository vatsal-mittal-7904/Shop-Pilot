'use server'

import { z } from 'zod'
import { prisma } from '@/backend/db/prisma'
import { requireCustomer, requireMerchant } from '@/backend/auth/session'
import { processPendingRefunds } from '@/backend/actions/refundProcessor'
import { Prisma } from '@prisma/client'

const cancellationInputSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().max(250).optional(),
})

export type CancellationResult = {
  success: boolean
  orderId: string
  status: 'CANCELLED'
  refundIssued: boolean
  refundId?: string
  restoredItemsCount?: number
  message: string
}

/**
 * Cancels an order on behalf of the authenticated customer.
 * If the order was PAID, atomically restores product inventory and enqueues a full refund.
 * If PAYMENT_PENDING, immediately transitions to CANCELLED and releases budget reservations.
 */
export async function cancelOrderByCustomer(input: z.infer<typeof cancellationInputSchema>): Promise<CancellationResult> {
  const { user, customer } = await requireCustomer()
  const { orderId, reason } = cancellationInputSchema.parse(input)
  const cancellationReason = reason || 'Customer requested order cancellation.'

  let refundIdToDispatch: string | null = null

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, customerId: customer.id },
      include: {
        payment: true,
        items: {
          include: { product: true },
          orderBy: { productId: 'asc' }, // deterministic ordering to prevent lock deadlocks
        },
      },
    })

    if (!order) {
      throw new Error('Order not found or not owned by this customer.')
    }

    if (order.status === 'CANCELLED') {
      return {
        success: true,
        orderId: order.id,
        status: 'CANCELLED' as const,
        refundIssued: false,
        message: 'Order is already cancelled.',
      }
    }

    if (order.status === 'EXPIRED' || order.status === 'PAYMENT_FAILED') {
      throw new Error(`Cannot cancel order in ${order.status} state.`)
    }

    // 1. Pending Order Cancellation (Pre-Payment)
    if (order.status === 'PAYMENT_PENDING' || order.status === 'INVENTORY_FAILED') {
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      })

      if (order.payment && order.payment.status === 'PENDING') {
        await tx.payment.update({
          where: { id: order.payment.id },
          data: { status: 'FAILED' },
        })
      }

      await tx.auditLog.create({
        data: {
          merchantId: order.merchantId,
          orderId: order.id,
          actorUserId: user.id,
          action: 'ORDER_CANCELLED_BY_CUSTOMER',
          status: 'APPROVED',
          reason: cancellationReason,
          details: {
            orderId: order.id,
            previousStatus: order.status,
            totalAmount: order.totalAmount,
          } as Prisma.InputJsonValue,
        },
      })

      return {
        success: true,
        orderId: order.id,
        status: 'CANCELLED' as const,
        refundIssued: false,
        message: 'Order cancelled successfully before payment settlement.',
      }
    }

    // 2. Paid Order Cancellation (Post-Payment Settlement)
    if (order.status === 'PAID') {
      const razorpayPaymentId = order.razorpayPaymentId || order.payment?.razorpayPaymentId
      if (!razorpayPaymentId) {
        throw new Error('Cannot process refund for paid order without verified provider payment reference.')
      }

      // Lock products in ascending order to prevent deadlocks
      const productIds = order.items.map((i) => i.productId)
      if (productIds.length > 0) {
        await tx.$executeRaw`
          SELECT id FROM "Product"
          WHERE id = ANY(${productIds})
          ORDER BY id ASC
          FOR UPDATE
        `

        // Restore inventory for each item
        for (const item of order.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { inventory: { increment: item.quantity } },
          })
        }
      }

      // Transition order status
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      })

      // Enqueue durable refund outbox row
      const refund = await tx.refund.create({
        data: {
          orderId: order.id,
          razorpayPaymentId,
          amount: order.totalAmount,
          currency: order.currency,
        },
      })

      refundIdToDispatch = refund.id

      await tx.auditLog.create({
        data: {
          merchantId: order.merchantId,
          orderId: order.id,
          actorUserId: user.id,
          action: 'ORDER_CANCELLED_AND_REFUND_QUEUED',
          status: 'EXECUTED',
          reason: `Customer cancelled paid order. Restored ${order.items.length} item line(s) and queued full refund of ₹${(
            order.totalAmount / 100
          ).toLocaleString('en-IN')}.`,
          details: {
            orderId: order.id,
            refundId: refund.id,
            razorpayPaymentId,
            refundAmount: order.totalAmount,
            restoredItemsCount: order.items.length,
          } as Prisma.InputJsonValue,
        },
      })

      return {
        success: true,
        orderId: order.id,
        status: 'CANCELLED' as const,
        refundIssued: true,
        refundId: refund.id,
        restoredItemsCount: order.items.length,
        message: 'Order cancelled. Inventory restored and automated refund dispatched.',
      }
    }

    throw new Error(`Unsupported cancellation state: ${order.status}`)
  }, { isolationLevel: 'Serializable' })

  // Trigger non-blocking opportunistic refund dispatch
  if (refundIdToDispatch) {
    processPendingRefunds(5).catch((err) => {
      console.warn('[CANCELLATION:ASYNC_REFUND_TRIGGER_ERROR]', err)
    })
  }

  return result
}

/**
 * Cancels an order on behalf of the authenticated merchant admin.
 */
export async function cancelOrderByMerchant(input: z.infer<typeof cancellationInputSchema>): Promise<CancellationResult> {
  const { user, merchant } = await requireMerchant()
  const { orderId, reason } = cancellationInputSchema.parse(input)
  const cancellationReason = reason || 'Merchant administrator cancelled order.'

  let refundIdToDispatch: string | null = null

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, merchantId: merchant.id },
      include: {
        payment: true,
        items: {
          include: { product: true },
          orderBy: { productId: 'asc' },
        },
      },
    })

    if (!order) {
      throw new Error('Order not found under this merchant.')
    }

    if (order.status === 'CANCELLED') {
      return {
        success: true,
        orderId: order.id,
        status: 'CANCELLED' as const,
        refundIssued: false,
        message: 'Order is already cancelled.',
      }
    }

    if (order.status === 'EXPIRED' || order.status === 'PAYMENT_FAILED') {
      throw new Error(`Cannot cancel order in ${order.status} state.`)
    }

    // 1. Pending Order
    if (order.status === 'PAYMENT_PENDING' || order.status === 'INVENTORY_FAILED') {
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      })

      if (order.payment && order.payment.status === 'PENDING') {
        await tx.payment.update({
          where: { id: order.payment.id },
          data: { status: 'FAILED' },
        })
      }

      await tx.auditLog.create({
        data: {
          merchantId: merchant.id,
          orderId: order.id,
          actorUserId: user.id,
          action: 'ORDER_CANCELLED_BY_MERCHANT',
          status: 'APPROVED',
          reason: cancellationReason,
          details: {
            orderId: order.id,
            previousStatus: order.status,
            totalAmount: order.totalAmount,
          } as Prisma.InputJsonValue,
        },
      })

      return {
        success: true,
        orderId: order.id,
        status: 'CANCELLED' as const,
        refundIssued: false,
        message: 'Order cancelled by merchant before payment settlement.',
      }
    }

    // 2. Paid Order
    if (order.status === 'PAID') {
      const razorpayPaymentId = order.razorpayPaymentId || order.payment?.razorpayPaymentId
      if (!razorpayPaymentId) {
        throw new Error('Cannot process refund for paid order without verified provider payment reference.')
      }

      const productIds = order.items.map((i) => i.productId)
      if (productIds.length > 0) {
        await tx.$executeRaw`
          SELECT id FROM "Product"
          WHERE id = ANY(${productIds})
          ORDER BY id ASC
          FOR UPDATE
        `

        for (const item of order.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { inventory: { increment: item.quantity } },
          })
        }
      }

      await tx.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      })

      const refund = await tx.refund.create({
        data: {
          orderId: order.id,
          razorpayPaymentId,
          amount: order.totalAmount,
          currency: order.currency,
        },
      })

      refundIdToDispatch = refund.id

      await tx.auditLog.create({
        data: {
          merchantId: merchant.id,
          orderId: order.id,
          actorUserId: user.id,
          action: 'ORDER_CANCELLED_BY_MERCHANT_AND_REFUND_QUEUED',
          status: 'EXECUTED',
          reason: `Merchant cancelled paid order. Restored ${order.items.length} item line(s) and queued full refund of ₹${(
            order.totalAmount / 100
          ).toLocaleString('en-IN')}.`,
          details: {
            orderId: order.id,
            refundId: refund.id,
            razorpayPaymentId,
            refundAmount: order.totalAmount,
            restoredItemsCount: order.items.length,
          } as Prisma.InputJsonValue,
        },
      })

      return {
        success: true,
        orderId: order.id,
        status: 'CANCELLED' as const,
        refundIssued: true,
        refundId: refund.id,
        restoredItemsCount: order.items.length,
        message: 'Merchant cancelled order. Inventory restored and automated refund dispatched.',
      }
    }

    throw new Error(`Unsupported cancellation state: ${order.status}`)
  }, { isolationLevel: 'Serializable' })

  if (refundIdToDispatch) {
    processPendingRefunds(5).catch((err) => {
      console.warn('[CANCELLATION:ASYNC_REFUND_TRIGGER_ERROR]', err)
    })
  }

  return result
}

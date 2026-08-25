'use server'

import { z } from 'zod'
import { razorpay } from '@/backend/services/razorpay'
import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'
import { createOrderFromOffer } from '@/backend/actions/commerce'

export async function startCheckout(offerId: string) {
  const order = await createOrderFromOffer(offerId)
  const razorpayOrder = await createRazorpayOrder(order.id)
  return { internalOrderId: order.id, razorpayOrder }
}

export async function createRazorpayOrder(internalOrderId: string) {
  const { user, customer } = await requireCustomer()
  const orderId = z.string().uuid().parse(internalOrderId)
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: customer.id },
    include: { payment: true, items: { include: { product: true } } },
  })
  if (!order) throw new Error('Order not found')
  if (!['ACCEPTED', 'PAYMENT_PENDING'].includes(order.status)) throw new Error('Order is not ready for payment')
  if (order.items.some((item) => item.product.inventory < item.quantity)) {
    await prisma.order.update({ where: { id: order.id }, data: { status: 'INVENTORY_FAILED' } })
    throw new Error('Inventory changed before checkout. Please request a new offer.')
  }
  if (order.razorpayOrderId && order.payment?.razorpayOrderId) {
    return { id: order.razorpayOrderId, amount: order.totalAmount, currency: order.currency }
  }

  const rzpOrder = await razorpay.orders.create({
    amount: order.totalAmount,
    currency: order.currency,
    receipt: order.id,
    notes: { merchantId: order.merchantId, internalOrderId: order.id },
  })

  return await prisma.$transaction(async (tx) => {
    const updateResult = await tx.order.updateMany({
      where: { id: order.id, razorpayOrderId: null },
      data: { razorpayOrderId: rzpOrder.id, status: 'PAYMENT_PENDING' }
    })

    if (updateResult.count === 0) {
      // Race condition detected: another request already generated a Razorpay order.
      // Fetch the existing one and return it, discarding our newly created rzpOrder.
      const existing = await tx.order.findUnique({ where: { id: order.id } })
      if (existing?.razorpayOrderId) {
        return { id: existing.razorpayOrderId, amount: order.totalAmount, currency: order.currency }
      }
      throw new Error('Order was modified concurrently.')
    }

    await tx.payment.update({ where: { orderId: order.id }, data: { razorpayOrderId: rzpOrder.id, status: 'PENDING' } })
    await tx.auditLog.create({ data: { orderId: order.id, merchantId: order.merchantId, actorUserId: user.id, action: 'RAZORPAY_ORDER_CREATED', status: 'EXECUTED', reason: 'Server created Razorpay order from validated internal order', details: { razorpayOrderId: rzpOrder.id } } })

    return { id: rzpOrder.id, amount: order.totalAmount, currency: order.currency }
  })
}

/**
 * Records that the customer's browser reported a submitted payment.
 *
 * Deliberately writes NOTHING but an AuditLog row. It must never advance
 * Order.status -- the client is an unverified signal for a money event. The
 * authoritative PAID transition (plus the inventory decrement) happens only in
 * the signature-verified webhook at src/app/api/webhooks/razorpay/route.ts.
 *
 * Called best-effort from CheckoutButton; a failure here has no bearing on the
 * payment itself, which is why it throws rather than trying to recover.
 */
export async function confirmPaymentPending(internalOrderId: string) {
  const { user, customer } = await requireCustomer()
  const orderId = z.string().uuid().parse(internalOrderId)

  // Scoped by customerId so a client can never log activity against another
  // customer's order.
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: customer.id },
    select: { id: true, merchantId: true, status: true, razorpayOrderId: true },
  })
  if (!order) throw new Error('Order not found')

  await prisma.auditLog.create({
    data: {
      merchantId: order.merchantId,
      orderId: order.id,
      actorUserId: user.id,
      action: 'PAYMENT_SUBMITTED_BY_CLIENT',
      status: 'PENDING',
      reason: 'Customer browser reported a submitted payment; awaiting webhook verification',
      details: { razorpayOrderId: order.razorpayOrderId, orderStatusAtSubmit: order.status },
    },
  })

  return { acknowledged: true as const, status: order.status }
}

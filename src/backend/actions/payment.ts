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
  if (order.razorpayOrderId && order.payment?.razorpayOrderId) {
    return { id: order.razorpayOrderId, amount: order.totalAmount, currency: order.currency }
  }
  if (!['ACCEPTED', 'PAYMENT_PENDING'].includes(order.status)) throw new Error('Order is not ready for payment')
  if (order.items.some((item) => item.product.inventory < item.quantity)) {
    await prisma.order.update({ where: { id: order.id }, data: { status: 'INVENTORY_FAILED' } })
    throw new Error('Inventory changed before checkout. Please request a new offer.')
  }

  const rzpOrder = await razorpay.orders.create({
    amount: order.totalAmount,
    currency: order.currency,
    receipt: order.id,
    notes: { merchantId: order.merchantId, internalOrderId: order.id },
  })

  await prisma.$transaction([
    prisma.order.update({ where: { id: order.id }, data: { razorpayOrderId: rzpOrder.id, status: 'PAYMENT_PENDING' } }),
    prisma.payment.update({ where: { orderId: order.id }, data: { razorpayOrderId: rzpOrder.id, status: 'PENDING' } }),
    prisma.auditLog.create({ data: { orderId: order.id, merchantId: order.merchantId, actorUserId: user.id, action: 'RAZORPAY_ORDER_CREATED', status: 'EXECUTED', reason: 'Server created Razorpay order from validated internal order', details: { razorpayOrderId: rzpOrder.id } } }),
  ])
  return rzpOrder
}

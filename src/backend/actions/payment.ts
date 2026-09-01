'use server'

import { z } from 'zod'
import { razorpay } from '@/backend/services/razorpay'
import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'
import { createOrReuseCheckoutOrder } from '@/backend/actions/order'

export async function startCheckout(offerId: string) {
  const { internalOrderId, razorpayOrder } = await createOrReuseCheckoutOrder(offerId)
  return { internalOrderId, razorpayOrder }
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

  // Razorpay makes `receipt` unique and lets us query orders by that receipt.
  // Persist it before calling the provider, then reconcile by it on every retry.
  // This closes the dangerous gap where Razorpay succeeds but the process dies
  // before the local `razorpayOrderId` write commits.
  const receipt = `mso_${order.id}`
  await prisma.order.updateMany({
    where: { id: order.id, razorpayReceipt: null },
    data: { razorpayReceipt: receipt },
  })

  const providerOrder = await findRazorpayOrderByReceipt(receipt)
  if (providerOrder) {
    assertProviderOrderMatches(order, providerOrder)
    return persistRazorpayOrder({ order, providerOrder, actorUserId: user.id, reconciled: true })
  }

  let rzpOrder
  try {
    rzpOrder = await razorpay.orders.create({
      amount: order.totalAmount,
      currency: order.currency,
      receipt,
      notes: { merchantId: order.merchantId, internalOrderId: order.id },
    })
  } catch (error) {
    // A timeout may conceal a successful create. Look up the unique receipt
    // once more before surfacing the failure, never blindly issuing another.
    const reconciled = await findRazorpayOrderByReceipt(receipt).catch(() => null)
    if (reconciled) {
      assertProviderOrderMatches(order, reconciled)
      return persistRazorpayOrder({ order, providerOrder: reconciled, actorUserId: user.id, reconciled: true })
    }
    await prisma.auditLog.create({
      data: {
        orderId: order.id,
        merchantId: order.merchantId,
        actorUserId: user.id,
        action: 'RAZORPAY_ORDER_CREATION_UNCERTAIN',
        status: 'PENDING',
        reason: 'Razorpay order creation did not return a usable response; retry will reconcile the unique receipt first.',
        details: { receipt },
      },
    })
    throw error
  }

  return persistRazorpayOrder({ order, providerOrder: rzpOrder, actorUserId: user.id, reconciled: false })
}

type InternalOrder = {
  id: string
  merchantId: string
  totalAmount: number
  currency: string
}

type ProviderOrder = {
  id: string
  amount: number | string
  currency: string
  receipt?: string
}

async function findRazorpayOrderByReceipt(receipt: string): Promise<ProviderOrder | null> {
  const response = await razorpay.orders.all({ receipt, count: 1 })
  return response.items.find((item) => item.receipt === receipt) ?? null
}

function assertProviderOrderMatches(order: InternalOrder, providerOrder: ProviderOrder) {
  if (Number(providerOrder.amount) !== order.totalAmount || providerOrder.currency !== order.currency) {
    throw new Error('Razorpay reconciliation found an order with a mismatched amount or currency. Payment is blocked.')
  }
}

async function persistRazorpayOrder({
  order,
  providerOrder,
  actorUserId,
  reconciled,
}: {
  order: InternalOrder
  providerOrder: ProviderOrder
  actorUserId: string
  reconciled: boolean
}) {
  return prisma.$transaction(async (tx) => {
    const updateResult = await tx.order.updateMany({
      where: { id: order.id, razorpayOrderId: null },
      data: { razorpayOrderId: providerOrder.id, status: 'PAYMENT_PENDING' }
    })

    if (updateResult.count === 0) {
      // A parallel request won the persistence race. Its provider order is the
      // one safe to return; the unique receipt prevents a second provider order.
      const existing = await tx.order.findUnique({ where: { id: order.id } })
      if (existing?.razorpayOrderId) {
        return { id: existing.razorpayOrderId, amount: order.totalAmount, currency: order.currency }
      }
      throw new Error('Order was modified concurrently.')
    }

    await tx.payment.update({ where: { orderId: order.id }, data: { razorpayOrderId: providerOrder.id, status: 'PENDING' } })
    // This queue is deliberately persisted with the local provider order. If a
    // webhook is delayed or lost, a worker can read the authoritative provider
    // state and apply it through the same guarded payment processor.
    await tx.paymentReconciliation.upsert({
      where: { orderId: order.id },
      create: { orderId: order.id },
      update: { status: 'PENDING', nextAttemptAt: new Date(), processingToken: null, processingStartedAt: null, lastError: null, resolvedAt: null },
    })
    await tx.auditLog.create({ data: {
      orderId: order.id,
      merchantId: order.merchantId,
      actorUserId,
      action: reconciled ? 'RAZORPAY_ORDER_RECONCILED' : 'RAZORPAY_ORDER_CREATED',
      status: 'EXECUTED',
      reason: reconciled
        ? 'Recovered Razorpay order by the persisted unique receipt after an uncertain boundary.'
        : 'Server created Razorpay order from validated internal order.',
      details: { razorpayOrderId: providerOrder.id, receipt: `mso_${order.id}` },
    } })

    return { id: providerOrder.id, amount: order.totalAmount, currency: order.currency }
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

/** Customer-scoped read model for the checkout UI. Webhooks remain the only
 * authority that can transition an order into a final payment state. */
export async function getCustomerOrderStatus(internalOrderId: string) {
  const { customer } = await requireCustomer()
  const orderId = z.string().uuid().parse(internalOrderId)
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: customer.id },
    select: { id: true, status: true, totalAmount: true, currency: true, razorpayOrderId: true, razorpayPaymentId: true, updatedAt: true },
  })
  if (!order) throw new Error('Order not found')
  return order
}

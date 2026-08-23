import { NextResponse } from 'next/server'
import { timingSafeEqual, createHmac } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/backend/db/prisma'

type RazorpayEvent = {
  id?: string
  event?: string
  payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; currency?: string } } }
}

function isValidSignature(body: string, signature: string) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) return false
  const expected = createHmac('sha256', secret).update(body).digest('hex')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const signatureBuffer = Buffer.from(signature, 'utf8')
  return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer)
}

export async function POST(req: Request) {
  const body = await req.text()
  const signature = req.headers.get('x-razorpay-signature')
  if (!signature || !isValidSignature(body, signature)) {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 })
  }

  let event: RazorpayEvent
  try {
    event = JSON.parse(body) as RazorpayEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!event.id || !event.event) return NextResponse.json({ error: 'Invalid webhook event' }, { status: 400 })

  const payment = event.payload?.payment?.entity
  try {
    await prisma.$transaction(async (tx) => {
      await tx.webhookEvent.create({ data: { razorpayEventId: event.id!, eventType: event.event!, payload: event as Prisma.InputJsonValue } })
      if (!payment?.order_id) return
      const order = await tx.order.findUnique({
        where: { razorpayOrderId: payment.order_id },
        include: { items: true, payment: true },
      })
      if (!order) return
      if (payment.amount !== order.totalAmount || payment.currency !== order.currency) {
        throw new Error('Webhook payment amount or currency does not match the internal order')
      }

      const paidEvent = event.event === 'payment.captured' || event.event === 'order.paid'
      if (paidEvent) {
        if (order.status !== 'PAID') {
          for (const item of order.items) {
            const result = await tx.product.updateMany({
              where: { id: item.productId, inventory: { gte: item.quantity } },
              data: { inventory: { decrement: item.quantity } },
            })
            if (result.count !== 1) throw new Error('Inventory became unavailable while processing payment')
          }
          await tx.order.update({ where: { id: order.id }, data: { status: 'PAID', razorpayPaymentId: payment.id } })
          await tx.payment.update({ where: { orderId: order.id }, data: { status: 'CAPTURED', razorpayPaymentId: payment.id } })
          await tx.auditLog.create({ data: { orderId: order.id, merchantId: order.merchantId, action: 'PAYMENT_CAPTURED', status: 'EXECUTED', reason: 'Verified Razorpay webhook marked order paid and reserved stock once', details: { razorpayEventId: event.id } } })
        }
      } else if (event.event === 'payment.failed' && order.status !== 'PAID') {
        await tx.order.update({ where: { id: order.id }, data: { status: 'PAYMENT_FAILED' } })
        await tx.payment.update({ where: { orderId: order.id }, data: { status: 'FAILED', razorpayPaymentId: payment.id } })
        await tx.auditLog.create({ data: { orderId: order.id, merchantId: order.merchantId, action: 'PAYMENT_FAILED', status: 'EXECUTED', reason: 'Verified Razorpay webhook reported payment failure', details: { razorpayEventId: event.id } } })
      }
      await tx.webhookEvent.update({ where: { razorpayEventId: event.id! }, data: { orderId: order.id, processedAt: new Date() } })
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ received: true, duplicate: true })
    }
    console.error('Razorpay webhook processing failed', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
  return NextResponse.json({ received: true })
}

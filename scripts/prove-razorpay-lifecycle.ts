/**
 * Razorpay Test-Mode Lifecycle Evidence Verifier
 *
 * This script never creates or simulates a payment. It verifies evidence from
 * a checkout that was actually completed through Razorpay Test Mode and whose
 * webhook was delivered to this application's configured endpoint.
 *
 * Usage:
 *   RAZORPAY_PROOF_ORDER_ID=<internal-order-uuid> npm run razorpay:proof
 */

import fs from 'node:fs'
import path from 'node:path'
import Razorpay from 'razorpay'
import { prisma } from '@/backend/db/prisma'
import { verifyAuditChain } from '@/backend/security/auditChainVerifier'

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m',
  cyan: '\x1b[36m', dim: '\x1b[2m', bgGreen: '\x1b[42m', black: '\x1b[30m',
}

type ProviderPayment = {
  id?: unknown
  amount?: unknown
  currency?: unknown
  status?: unknown
  order_id?: unknown
  created_at?: unknown
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function assertEvidence(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function paymentFromWebhook(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null
  const entity = (payload as { payload?: { payment?: { entity?: unknown } } }).payload?.payment?.entity
  if (!entity || typeof entity !== 'object') return null
  const record = entity as Record<string, unknown>
  return {
    id: typeof record.id === 'string' ? record.id : null,
    orderId: typeof record.order_id === 'string' ? record.order_id : null,
    amount: typeof record.amount === 'number' ? record.amount : null,
    currency: typeof record.currency === 'string' ? record.currency : null,
  }
}

async function runRazorpayProof() {
  console.log(`\n${c.bold}================================================================================${c.reset}`)
  console.log(`${c.bold} 💳 Razorpay Test-Mode Lifecycle Evidence Verifier${c.reset}`)
  console.log(`${c.bold}================================================================================${c.reset}\n`)

  const internalOrderId = requireValue(process.env.RAZORPAY_PROOF_ORDER_ID, 'RAZORPAY_PROOF_ORDER_ID')
  const keyId = requireValue(process.env.RAZORPAY_KEY_ID, 'RAZORPAY_KEY_ID')
  const keySecret = requireValue(process.env.RAZORPAY_KEY_SECRET, 'RAZORPAY_KEY_SECRET')
  assertEvidence(keyId.startsWith('rzp_test_'), 'Proof requires Razorpay Test Mode credentials (rzp_test_...).')

  console.log(`  • Internal order: ${internalOrderId}`)
  console.log(`  • Provider mode: ${c.green}Razorpay Test Mode${c.reset}`)

  const order = await prisma.order.findUnique({ where: { id: internalOrderId }, include: { payment: true } })
  assertEvidence(order, 'Internal order was not found.')
  assertEvidence(order.razorpayOrderId, 'Internal order has no persisted Razorpay order ID.')
  assertEvidence(order.razorpayPaymentId, 'Internal order has no captured Razorpay payment ID.')
  assertEvidence(order.status === 'PAID', `Internal order is ${order.status}, not PAID.`)

  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret })
  console.log(`\n  ${c.dim}[1/4] Fetching order and payments from Razorpay...${c.reset}`)
  const [providerOrder, providerPaymentsResult] = await Promise.all([
    razorpay.orders.fetch(order.razorpayOrderId),
    razorpay.orders.fetchPayments(order.razorpayOrderId),
  ])
  const providerPayments = Array.isArray(providerPaymentsResult.items) ? providerPaymentsResult.items as ProviderPayment[] : []
  const payment = providerPayments.find((candidate) => candidate.id === order.razorpayPaymentId)

  assertEvidence(Number(providerOrder.amount) === order.totalAmount, 'Razorpay order amount does not match the internal order.')
  assertEvidence(providerOrder.currency === order.currency, 'Razorpay order currency does not match the internal order.')
  assertEvidence(payment, 'Razorpay does not report the internal payment ID for this order.')
  assertEvidence(payment.status === 'captured', `Razorpay payment is ${String(payment.status)}, not captured.`)
  assertEvidence(Number(payment.amount) === order.totalAmount, 'Captured Razorpay payment amount does not match the internal order.')
  assertEvidence(payment.currency === order.currency, 'Captured Razorpay payment currency does not match the internal order.')
  assertEvidence(payment.order_id === order.razorpayOrderId, 'Captured Razorpay payment belongs to another order.')
  console.log(`  ${c.green}✔${c.reset} Provider order ${providerOrder.id} and captured payment ${String(payment.id)} agree with the internal order.`)

  console.log(`\n  ${c.dim}[2/4] Verifying an externally delivered webhook receipt...${c.reset}`)
  const webhookEvents = await prisma.webhookEvent.findMany({
    where: { orderId: order.id, eventType: { in: ['payment.captured', 'order.paid'] }, processedAt: { not: null } },
    orderBy: { createdAt: 'asc' },
  })
  const webhook = webhookEvents.find((event) => {
    const webhookPayment = paymentFromWebhook(event.payload)
    return webhookPayment?.id === order.razorpayPaymentId && webhookPayment.orderId === order.razorpayOrderId &&
      webhookPayment.amount === order.totalAmount && webhookPayment.currency === order.currency
  })
  assertEvidence(webhook, 'No processed Razorpay webhook receipt matches this captured payment. Configure a reachable webhook endpoint and complete checkout before running this verifier.')
  console.log(`  ${c.green}✔${c.reset} Received and processed Razorpay webhook event ${webhook.razorpayEventId}.`)

  console.log(`\n  ${c.dim}[3/4] Verifying local payment state and audit chain...${c.reset}`)
  assertEvidence(order.payment?.status === 'CAPTURED', 'Local payment record is not CAPTURED.')
  assertEvidence(order.payment?.razorpayPaymentId === order.razorpayPaymentId, 'Local payment and order disagree on Razorpay payment ID.')
  const auditLogs = await prisma.auditLog.findMany({
    where: { merchantId: order.merchantId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const auditVerification = verifyAuditChain(auditLogs)
  const captureAudit = auditLogs.find((entry) => entry.orderId === order.id && entry.action === 'PAYMENT_CAPTURED' && entry.status === 'EXECUTED')
  assertEvidence(captureAudit, 'No PAYMENT_CAPTURED audit entry exists for this order.')
  assertEvidence(auditVerification.valid, 'The merchant audit chain is invalid.')
  console.log(`  ${c.green}✔${c.reset} Local state is PAID/CAPTURED and ${auditVerification.totalEntries} audit entries form a valid chain.`)

  console.log(`\n  ${c.dim}[4/4] Writing evidence artifact...${c.reset}`)
  const proofDir = path.join(process.cwd(), 'artifacts')
  fs.mkdirSync(proofDir, { recursive: true })
  const proofArtifactPath = path.join(proofDir, 'razorpay-provider-proof.json')
  const proofData = {
    format: 'merchantos.razorpay-test-mode-evidence.v2',
    verifiedAt: new Date().toISOString(),
    provider: {
      mode: 'RAZORPAY_TEST_MODE', keyIdPrefix: `${keyId.slice(0, 8)}...`, razorpayOrderId: order.razorpayOrderId,
      amountPaise: Number(providerOrder.amount), currency: providerOrder.currency, status: providerOrder.status,
    },
    payment: {
      razorpayPaymentId: order.razorpayPaymentId, amountPaise: Number(payment.amount), currency: payment.currency,
      status: payment.status, providerCreatedAt: payment.created_at ?? null,
    },
    webhookReceipt: {
      razorpayEventId: webhook.razorpayEventId, eventType: webhook.eventType, receivedAt: webhook.createdAt.toISOString(),
      processedAt: webhook.processedAt?.toISOString() ?? null,
    },
    databaseVerification: {
      internalOrderId: order.id, finalStatus: order.status, paymentStatus: order.payment.status,
      verifiedPaymentId: order.razorpayPaymentId,
    },
    auditChain: { totalEntries: auditVerification.totalEntries, chainHead: auditVerification.chainHead, valid: auditVerification.valid },
  }
  fs.writeFileSync(proofArtifactPath, JSON.stringify(proofData, null, 2))
  console.log(`  ${c.green}✔${c.reset} Evidence written to ${proofArtifactPath}`)
  console.log(`\n${c.bgGreen}${c.black}${c.bold} ✔ REAL RAZORPAY TEST-MODE LIFECYCLE EVIDENCE VERIFIED ${c.reset}\n`)
}

runRazorpayProof()
  .catch((error) => {
    console.error(`\n${c.red}✖ Provider evidence verification failed:${c.reset}`, error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

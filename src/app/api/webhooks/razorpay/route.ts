import crypto from 'node:crypto'
import { prisma } from '@/backend/db/prisma'
import { processRazorpayEvent } from '@/backend/actions/webhookProcessor'

/**
 * Razorpay signs webhooks with an X-Razorpay-Signature header: an
 * HMAC-SHA256 hex digest computed over the exact raw request bytes, keyed
 * with the dashboard-configured webhook secret. The event id used for
 * idempotency (X-Razorpay-Event-Id) is also a header, not a payload field.
 */

function isValidSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const expectedBuffer = Buffer.from(expected, 'hex')
  const providedBuffer = Buffer.from(signatureHeader, 'hex')
  if (expectedBuffer.length !== providedBuffer.length) return false

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer)
}

export async function POST(req: Request) {
  // --- 1. Signature verification -------------------------------------------
  // Read the body as raw text before anything else touches it. Parsing to
  // JSON and re-serializing (JSON.stringify(parsed)) does not reliably
  // reproduce the exact bytes Razorpay signed -- key order, spacing, and
  // number formatting can all shift -- so the HMAC must run over this raw
  // string, never a reconstruction of it.
  const rawBody = await req.text()
  const signatureHeader = req.headers.get('x-razorpay-signature')

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) {
    console.error('RAZORPAY_WEBHOOK_SECRET is not configured')
    return Response.json({ error: 'Webhook is not configured' }, { status: 400 })
  }
  if (!signatureHeader) {
    return Response.json({ error: 'Missing signature' }, { status: 400 })
  }
  if (!isValidSignature(rawBody, signatureHeader, secret)) {
    // Signature mismatch: stop here. No database read or write of any kind
    // for a request we can't authenticate as genuinely from Razorpay.
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // --- 2. Idempotency check --------------------------------------------------
  // Only now, with the signature verified, is it safe to parse and act on
  // the body.
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: 'Malformed JSON payload' }, { status: 400 })
  }

  const razorpayEventId = req.headers.get('x-razorpay-event-id')
  if (!razorpayEventId) {
    return Response.json({ error: 'Missing x-razorpay-event-id header' }, { status: 400 })
  }

  const eventType = typeof payload.event === 'string' ? payload.event : 'unknown'

  // Cheap fast path so a redelivery doesn't pay for a Serializable
  // transaction. processRazorpayEvent repeats this check inside its own
  // transaction, which is the authoritative one -- and because it writes the
  // WebhookEvent row and sets processedAt in the same commit, any row visible
  // here is one that was fully processed.
  const existing = await prisma.webhookEvent.findUnique({ where: { razorpayEventId } })
  if (existing) {
    // Razorpay retries deliver the same event id. We've already recorded
    // this one, so acknowledge without reprocessing.
    return Response.json({ status: 'already_processed' }, { status: 200 })
  }

  // --- 3. Handoff -------------------------------------------------------------
  // The per-delivery event id arrives as a header, but the processor validates
  // it as a payload field, so it is merged in here.
  //
  // The processor owns the WebhookEvent ledger row: it inserts the row, applies
  // the state mutation, and stamps processedAt inside a single Serializable
  // transaction. That is why this route does not write the row itself. Writing
  // it here after the fact would both collide with the processor's insert
  // (razorpayEventId is @unique -- a guaranteed P2002 on every success) and
  // sit outside any transaction, so a crash in between would leave an event
  // that was fully applied with no ledger row to prove it. Keeping the insert
  // inside the processor's transaction means a failed attempt leaves no record
  // at all, so Razorpay's retry of the same event id naturally re-attempts it.
  try {
    await processRazorpayEvent({ ...payload, razorpayEventId })
  } catch (error) {
    console.error('processRazorpayEvent failed', { razorpayEventId, eventType, error })
    // Non-2xx tells Razorpay to retry this delivery later.
    return Response.json({ error: 'Processing failed' }, { status: 500 })
  }

  return Response.json({ status: 'ok' }, { status: 200 })
}

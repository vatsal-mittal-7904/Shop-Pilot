import { z } from 'zod'
import { google } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { Prisma } from '@prisma/client'
import { prisma } from '@/backend/db/prisma'

/**
 * Deliberately NOT a `'use server'` module, matching policyEngine.ts's own
 * convention in this codebase: it takes customerId as a caller-supplied
 * argument with no session check inside, so exposing it as a client-callable
 * server action would let any browser write BuyerIntent rows for another
 * customer. Server-side callers only (e.g. the chat route, which already
 * holds an authenticated customer.id from requireCustomer()).
 */

// Cheap pre-filter for obvious acknowledgements, so a plain "thanks" or "ok"
// never spends a structured-output call. Anchored to the whole trimmed
// message so short-but-real requests ("keyboard", "under 8000") are never
// caught by this -- only exact conversational filler is.
const FILLER_PATTERN = /^(ok(ay)?|thanks?|thank you|thx|sounds? good|great|cool|nice|got it|sure|yes|yeah|yep|no|nope|alright|perfect|awesome|hi|hello|hey)[.!\s]*$/i

const INTENT_REFRESH_WINDOW_MS = 30 * 60 * 1000 // merge into the same intent if refined within 30 minutes; otherwise start a new one

const intentExtractionSchema = z.object({
  isActionable: z
    .boolean()
    .describe(
      'True if this message contains new or updated shopping requirements (a product category, feature, or budget). False for greetings, thanks, acknowledgements, or messages with no shopping signal.',
    ),
  intentAction: z
    .enum(['UPDATE', 'REPLACE'])
    .describe(
      'UPDATE to merge these new requirements with existing ones (e.g. "make it red"). REPLACE to overwrite the previous intent entirely (e.g. "actually I want a mouse instead", or "start over").'
    ),
  clearBudget: z
    .boolean()
    .describe('True if the user explicitly states they have no budget limit anymore.'),
  category: z
    .array(z.string())
    .describe('Product categories or keywords implied by the message, e.g. ["keyboard", "mechanical"]. Empty array if none.'),
  requirements: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .describe('Product attributes mentioned, e.g. [{"key": "switch", "value": "mechanical"}]. Empty array if none.'),
  maximumAmount: z
    .number()
    .nullable()
    .describe('Maximum budget in plain rupees as stated by the customer (e.g. 8000 for "under 8000 rupees"), or null if no budget was mentioned.'),
})

type ExtractedIntent = z.infer<typeof intentExtractionSchema>

/**
 * Parses a raw customer message into a structured BuyerIntent, merging into
 * the customer's most recent intent if it was updated within the refresh
 * window (treated as the same ongoing negotiation), or creating a new row
 * otherwise. BuyerIntent has no unique constraint enabling a true DB-level
 * upsert, so this is an application-level upsert: find-most-recent, then
 * update or create.
 *
 * Returns null (never throws) for conversational filler, for messages with
 * no extractable shopping signal, or if the structured-output call or the
 * database write fails -- callers (the chat route) must be able to continue
 * the conversation even when intent capture doesn't happen for a given turn.
 */
export async function parseBuyerIntent(customerId: string, rawMessage: string) {
  const trimmed = rawMessage.trim()
  if (!trimmed) return null
  if (FILLER_PATTERN.test(trimmed)) return null

  let extracted: ExtractedIntent
  try {
    const { object } = await generateObject({
      model: google('gemini-3.6-flash'),
      schema: intentExtractionSchema,
      prompt: `Extract shopping intent from this customer message for an electronics storefront (categories include keyboard, mouse, headphones, monitor, webcam, accessory). If the user explicitly asks to remove, clear, or ignore their previous budget limit, set clearBudget to true. Message: "${trimmed}"`,
    })
    extracted = object
  } catch {
    // Structured-output call failed or returned something that didn't match
    // the schema -- degrade gracefully, do not crash the chat request.
    return null
  }

  if (!extracted.isActionable) return null
  const hasSignal = extracted.category.length > 0 || extracted.requirements.length > 0 || extracted.maximumAmount != null || extracted.clearBudget || extracted.intentAction === 'REPLACE'
  if (!hasSignal) return null

  // Convert stated rupees to the same unit as Product.price (paise), matching
  // the existing regex-based parseIntent() convention in commerce.ts.
  const maximumAmount = extracted.maximumAmount != null ? Math.round(extracted.maximumAmount * 100) : null

  try {
    const recent = await prisma.buyerIntent.findFirst({
      where: { customerId, updatedAt: { gt: new Date(Date.now() - INTENT_REFRESH_WINDOW_MS) } },
      orderBy: { updatedAt: 'desc' },
    })

    let mergedCategory = extracted.category
    let mergedRequirements = extracted.requirements.reduce((acc, req) => { acc[req.key] = req.value; return acc; }, {} as Record<string, string>)
    let resolvedMaximumAmount = extracted.clearBudget ? null : maximumAmount

    if (recent && extracted.intentAction === 'UPDATE') {
      const previousRequirements = (recent?.requirements as Record<string, string> | null) ?? {}
      mergedCategory = Array.from(new Set([...recent.category, ...extracted.category]))
      mergedRequirements = { ...previousRequirements, ...mergedRequirements }
      if (!extracted.clearBudget) {
        resolvedMaximumAmount = maximumAmount ?? recent.maximumAmount ?? null
      }
    }

    if (recent) {
      return await prisma.buyerIntent.update({
        where: { id: recent.id },
        data: {
          category: mergedCategory,
          requirements: mergedRequirements as Prisma.InputJsonValue,
          maximumAmount: resolvedMaximumAmount,
          rawRequest: trimmed,
          // Hardcoded server-side on every write, never derived from model
          // output -- the LLM's extraction never determines these booleans.
          autonomousPurchase: false,
          requiresConfirmation: true,
        },
      })
    }

    return await prisma.buyerIntent.create({
      data: {
        customerId,
        category: mergedCategory,
        requirements: mergedRequirements as Prisma.InputJsonValue,
        maximumAmount: resolvedMaximumAmount,
        currency: 'INR',
        rawRequest: trimmed,
        autonomousPurchase: false,
        requiresConfirmation: true,
      },
    })
  } catch {
    // DB write failed -- same fault-tolerance contract as the extraction
    // step above: never let intent capture crash the chat request.
    return null
  }
}

import { z } from 'zod'
import { generateObject } from 'ai'
import { Prisma } from '@prisma/client'
import { prisma } from '@/backend/db/prisma'
import { aiModel } from '@/backend/ai/model'

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
      model: aiModel(),
      schema: intentExtractionSchema,
      prompt: `Extract shopping intent from this customer message for an electronics storefront (categories include keyboard, mouse, headphones, monitor, webcam, accessory). If the user explicitly asks to remove, clear, or ignore their previous budget limit, set clearBudget to true. Message: "${trimmed}"`,
    })
    extracted = object
  } catch (error) {
    // Structured-output call failed or returned something that didn't match
    // the schema -- degrade gracefully, do not crash the chat request.
    //
    // Logged rather than swallowed silently: returning null here means
    // search_catalog runs with no buyer intent and answers with generic
    // products, which is indistinguishable from the model just being bad at
    // its job. A misconfigured AI_MODEL fails exactly this way on every
    // turn, so the reason needs to reach the server log.
    console.error('parseBuyerIntent: intent extraction failed, continuing without intent:', error)
    return null
  }

  if (!extracted.isActionable) return null
  const hasSignal = extracted.category.length > 0 || extracted.requirements.length > 0 || extracted.maximumAmount != null || extracted.clearBudget || extracted.intentAction === 'REPLACE'
  if (!hasSignal) return null

  // Rely purely on the AI Model's structured output for budget extraction
  // rather than a brittle regex fallback.
  const maximumAmount = extracted.maximumAmount != null ? Math.round(extracted.maximumAmount * 100) : null

  try {
    const recent = await prisma.buyerIntent.findFirst({
      where: { customerId, updatedAt: { gt: new Date(Date.now() - INTENT_REFRESH_WINDOW_MS) } },
      orderBy: { updatedAt: 'desc' },
    })

    let mergedCategory = extracted.category
    let mergedRequirements = extracted.requirements.reduce((acc, req) => { acc[req.key] = req.value; return acc; }, {} as Record<string, string>)
    
    // MONEY-SAFETY INVARIANT:
    // Conversational model extraction is allowed to establish an initial budget or narrow/lower an existing budget.
    // However, an LLM extraction can NEVER unilaterally lift or clear an active budget limit without explicit customer authorization.
    // If an existing budget exists, attempts to clear it or raise it above the existing ceiling fail-closed and retain the active ceiling.
    // This invariant strictly applies to BOTH incremental updates AND intent replacements (REPLACE).
    let resolvedMaximumAmount: number | null = null

    if (recent?.maximumAmount != null) {
      if (extracted.clearBudget) {
        console.warn(`[BUDGET_POLICY] Ignored conversational attempt to clear active budget ceiling of ₹${recent.maximumAmount / 100} for customer ${customerId}. Retaining active budget.`)
        resolvedMaximumAmount = recent.maximumAmount
        mergedRequirements.pendingBudgetIncrease = 'UNLIMITED'
        mergedRequirements.budgetIncreaseRequiresAuthorization = 'true'
      } else if (maximumAmount != null && maximumAmount > recent.maximumAmount) {
        console.warn(`[BUDGET_POLICY] Blocked conversational attempt to increase budget ceiling from ₹${recent.maximumAmount / 100} to ₹${maximumAmount / 100} for customer ${customerId}. Retaining active ceiling.`)
        resolvedMaximumAmount = recent.maximumAmount
        mergedRequirements.pendingBudgetIncrease = String(maximumAmount)
        mergedRequirements.budgetIncreaseRequiresAuthorization = 'true'
      } else if (maximumAmount != null) {
        // Narrowed or maintained budget is safe
        resolvedMaximumAmount = maximumAmount
      } else {
        // No new monetary value mentioned - retain active ceiling unconditionally
        resolvedMaximumAmount = recent.maximumAmount
      }
    } else {
      // No active budget ceiling set yet: accept initial intent extraction
      resolvedMaximumAmount = extracted.clearBudget ? null : maximumAmount
    }

    if (recent && extracted.intentAction === 'UPDATE') {
      const previousRequirements = (recent?.requirements as Record<string, string> | null) ?? {}
      mergedCategory = Array.from(new Set([...recent.category, ...extracted.category]))
      mergedRequirements = { ...previousRequirements, ...mergedRequirements }
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

/**
 * Authoritatively updates or clears a customer's active budget limit.
 * Must be invoked by an authenticated customer action, never by prompt extraction.
 */
export async function authorizeCustomerBudgetUpdate({
  customerId,
  actorUserId,
  budgetAmount,
}: {
  customerId: string
  actorUserId: string
  budgetAmount: number | null
}) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: { dailySpendLimit: true },
    })
    if (!customer) throw new Error('Customer account not found')

    if (budgetAmount != null) {
      if (budgetAmount <= 0 || !Number.isInteger(budgetAmount)) {
        throw new Error('Authorized budget must be a positive integer in paise.')
      }
      if (budgetAmount > customer.dailySpendLimit) {
        throw new Error(`Authorized budget cannot exceed the account daily spend limit of ₹${(customer.dailySpendLimit / 100).toLocaleString('en-IN')}.`)
      }
    }

    const recent = await tx.buyerIntent.findFirst({
      where: { customerId },
      orderBy: { updatedAt: 'desc' },
    })

    let updatedIntent
    if (recent) {
      const requirements = (recent.requirements as Record<string, string> | null) ?? {}
      delete requirements.pendingBudgetIncrease
      delete requirements.budgetIncreaseRequiresAuthorization

      updatedIntent = await tx.buyerIntent.update({
        where: { id: recent.id },
        data: {
          maximumAmount: budgetAmount,
          requirements: requirements as Prisma.InputJsonValue,
        },
      })
    } else {
      updatedIntent = await tx.buyerIntent.create({
        data: {
          customerId,
          category: [],
          requirements: {},
          maximumAmount: budgetAmount,
          currency: 'INR',
          rawRequest: 'Explicit customer budget authorization',
          autonomousPurchase: false,
          requiresConfirmation: true,
        },
      })
    }

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: 'CUSTOMER_BUDGET_CAP_MODIFIED',
        status: 'APPROVED',
        reason: budgetAmount != null
          ? `Customer explicitly authorized budget cap of ₹${(budgetAmount / 100).toLocaleString('en-IN')}`
          : 'Customer explicitly cleared conversational budget ceiling',
        details: {
          previousMaximumAmount: recent?.maximumAmount ?? null,
          newMaximumAmount: budgetAmount,
          customerId,
        } as Prisma.InputJsonValue,
      },
    })

    return { success: true, maximumAmount: updatedIntent.maximumAmount }
  })
}

/**
 * Authoritatively updates a customer's pre-authorized autonomous checkout settings.
 * Must be invoked by an authenticated customer action with explicit boundary constraints.
 */
export async function authorizeCustomerAutonomousMode({
  customerId,
  actorUserId,
  enabled,
  spendCeilingPaise,
}: {
  customerId: string
  actorUserId: string
  enabled: boolean
  spendCeilingPaise?: number | null
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Customer" WHERE id = ${customerId} FOR UPDATE`

    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: { dailySpendLimit: true, deliveryProfile: true },
    })
    if (!customer) throw new Error('Customer account not found')

    if (spendCeilingPaise !== undefined && spendCeilingPaise !== null) {
      if (spendCeilingPaise <= 0 || !Number.isInteger(spendCeilingPaise)) {
        throw new Error('Autonomous spend ceiling must be a positive integer in paise.')
      }
      if (spendCeilingPaise > customer.dailySpendLimit) {
        throw new Error(`Autonomous spend ceiling cannot exceed account daily limit of ₹${(customer.dailySpendLimit / 100).toLocaleString('en-IN')}.`)
      }
    }

    const currentProfile = (customer.deliveryProfile as Record<string, unknown> | null) ?? {}
    const newProfile = {
      ...currentProfile,
      autonomousCheckoutEnabled: enabled,
      ...(spendCeilingPaise !== undefined ? { autonomousSpendCeiling: spendCeilingPaise } : {}),
    }

    await tx.customer.update({
      where: { id: customerId },
      data: {
        deliveryProfile: newProfile as Prisma.InputJsonValue,
      },
    })

    const recent = await tx.buyerIntent.findFirst({
      where: { customerId },
      orderBy: { updatedAt: 'desc' },
    })
    if (recent) {
      await tx.buyerIntent.update({
        where: { id: recent.id },
        data: {
          autonomousPurchase: enabled,
          requiresConfirmation: !enabled,
        },
      })
    }

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: 'CUSTOMER_AUTONOMOUS_MODE_UPDATED',
        status: 'APPROVED',
        reason: enabled
          ? `Customer explicitly authorized autonomous agent checkout with ceiling of ₹${(((spendCeilingPaise ?? customer.dailySpendLimit)) / 100).toLocaleString('en-IN')}`
          : 'Customer explicitly disabled autonomous agent checkout',
        details: {
          customerId,
          enabled,
          spendCeilingPaise: spendCeilingPaise ?? null,
        } as Prisma.InputJsonValue,
      },
    })

    return {
      success: true,
      autonomousCheckoutEnabled: enabled,
      autonomousSpendCeiling: spendCeilingPaise ?? (newProfile.autonomousSpendCeiling as number | undefined) ?? null,
    }
  })
}

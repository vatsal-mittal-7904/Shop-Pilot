'use server'

import { z } from 'zod'
import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'

const conversationIdSchema = z.string().uuid()

// Session A had 'BUNDLE_OFFER' here, which matches nothing: the only two
// AgentAction rows that carry a DiscountPolicyResult are written by
// api/chat/route.ts as 'DISCOUNT_OFFER' (generate_checkout_offer, L354) and
// 'BUNDLE_ADDON_OFFER' (propose_bundle_addon, L305). With the old name every
// bundle policy decision was silently filtered out and the caller saw a
// half-empty list with no error.
//
// The other two writers (merchant.ts campaign actions) are deliberately excluded:
// they write status 'EXECUTED' and a { allowed, reason } policyResult, not the
// { checked, passed, limit, requested, reason } shape PolicyBadge parses.
const RELEVANT_ACTION_TYPES = ['DISCOUNT_OFFER', 'BUNDLE_ADDON_OFFER'] as const

export type AgentActionSummary = {
  id: string
  type: string
  status: string
  policyResult: unknown
}

/**
 * ⚠️ KNOWN LIMITATION -- read before using this in production.
 *
 * `AgentAction` has no `conversationId`, `customerId`, `offerId`, or
 * `orderId` column -- only `merchantId`. There is no field anywhere on the
 * model (including inside its `input`/`policyResult` Json blobs, as written
 * by generate_checkout_offer and merchant.ts's campaign actions) that ties a
 * given row back to a specific conversation or customer.
 *
 * That means this function CANNOT actually scope results to one
 * conversation. What it does instead: verifies the caller owns the
 * requested Conversation, then returns the merchant's most recent
 * DISCOUNT_OFFER / BUNDLE_ADDON_OFFER actions -- across ALL of that merchant's
 * customers, not just this one. Returning that as "this conversation's
 * actions" would leak other customers' discount negotiation history to
 * whoever is viewing this chat.
 *
 * Do not expose this to end users as-is. Fix properly by adding a
 * `conversationId String?` (or at least `customerId String?`) column to
 * AgentAction, populating it at every call site that creates one, and
 * filtering on it here.
 *
 * VERIFIED AGAINST prisma/schema.prisma: the limitation above is real. AgentAction
 * is { id, merchantId, type, reason, input, policyResult, expectedImpact, status,
 * campaignId, createdAt, updatedAt } -- no customer or conversation link exists.
 * Because of that this function is NOT wired into the customer-facing chat
 * (src/app/agent/page.tsx); that page renders PolicyBadge from the per-message
 * tool result instead, which is conversation-scoped by construction. See the
 * Day 11 merge notes. This function is kept for the merchant-side surface, where
 * merchant-wide scope is correct rather than a leak.
 */
export async function getRecentAgentActions(conversationId: string): Promise<AgentActionSummary[]> {
  const { customer } = await requireCustomer()
  const id = conversationIdSchema.parse(conversationId)

  const conversation = await prisma.conversation.findFirst({
    where: { id, customerId: customer.id },
    select: { id: true, merchantId: true },
  })
  if (!conversation) throw new Error('Conversation not found')

  const actions = await prisma.agentAction.findMany({
    where: {
      merchantId: conversation.merchantId,
      conversationId: conversation.id,
      type: { in: [...RELEVANT_ACTION_TYPES] },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      type: true,
      status: true,
      policyResult: true,
    },
  })

  return actions
}

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
 * Returns the policy decisions the agent made inside one conversation: that
 * conversation's DISCOUNT_OFFER / BUNDLE_ADDON_OFFER actions, most recent first.
 *
 * Scoped on three axes, all load-bearing:
 *   - `customerId` on the Conversation lookup, so a caller can only ask about a
 *     conversation they actually own;
 *   - `conversationId` on the actions, so the result is this conversation's
 *     decisions rather than the whole merchant's;
 *   - `merchantId` alongside it -- redundant given the FK, but it keeps the query
 *     correct rather than merely passing if a row is ever re-parented.
 *
 * History, because it explains the shape: this function originally could not scope
 * by conversation at all. AgentAction carried only `merchantId`, so the narrowest
 * thing it could return was every customer's discount negotiations for that
 * merchant, and it was documented as unsafe to expose to end users. The
 * `conversationId` column (migration 20260825120000_add_agentaction_conversation)
 * closed that hole, and both writers in api/chat/route.ts (L305, L355) populate it.
 *
 * What deliberately does NOT set it: merchant.ts's two campaign writers (L146,
 * L222). A campaign approval happens on the merchant dashboard with no
 * conversation in scope, so NULL is the honest value there -- and those rows are
 * excluded from this query by `type` regardless.
 *
 * Rows written before that migration keep conversationId NULL and never appear
 * here. Intentional: they cannot be attributed to a conversation after the fact.
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

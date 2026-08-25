import { z } from 'zod'
import { prisma } from '@/backend/db/prisma'

const MAX_DISCOUNT_POLICY_KEY = 'MAX_DISCOUNT_PERCENTAGE'

const requestedPercentSchema = z.number().finite().min(0)

export type DiscountPolicyResult = {
  checked: string[]
  passed: boolean
  limit: number
  requested: number
  reason: string
}

/**
 * Evaluates a requested discount percentage against the merchant's
 * MAX_DISCOUNT_PERCENTAGE policy. Read-only: issues a single MerchantPolicy
 * lookup and performs no writes, so it is safe to call speculatively (e.g.
 * to preview whether an action would be allowed) without side effects.
 *
 * Deliberately NOT a `'use server'` module, unlike its siblings in this
 * directory: it takes merchantId as a caller-supplied argument, so exposing
 * it as a client-callable server action would let any browser probe another
 * merchant's policy. Server-side callers only.
 */
export async function evaluateDiscount(merchantId: string, requestedPercent: number): Promise<DiscountPolicyResult> {
  const requested = requestedPercentSchema.parse(requestedPercent)

  const policy = await prisma.merchantPolicy.findUnique({
    where: { merchantId_key: { merchantId, key: MAX_DISCOUNT_POLICY_KEY } },
  })
  const limit = policy?.value ?? 0
  const passed = requested <= limit

  return {
    checked: [MAX_DISCOUNT_POLICY_KEY],
    passed,
    limit,
    requested,
    reason: passed
      ? `Requested discount of ${requested}% is within the ${limit}% merchant limit.`
      : `Requested discount of ${requested}% exceeds the ${limit}% merchant limit.`,
  }
}

import { prisma } from '@/backend/db/prisma'
import { z } from 'zod'
import { getRecoveryAttribution } from '@/backend/actions/recoveryAttribution'
import { calculateMerchantUplift, type UpliftExperimentMetrics } from '@/backend/actions/upliftExperiment'

export type MerchantROIMetrics = {
  totalRevenueGenerated: number;
  abandonedCartsRecovered: number;
  crossSellPaidRate: number;
  crossSellTotal: number;
  crossSellAccepted: number;
  crossSellPaid: number;
  crossSellIncrementalRevenue: number;
  upsellPaidRate: number;
  upsellTotal: number;
  upsellAccepted: number;
  upsellPaid: number;
  upsellIncrementalRevenue: number;
  totalAiAttributedRevenue: number;
  blockedDiscountPolicyRequests: number;
  aiRecoveredRevenue: number;
  attributionMethodology: {
    model: string;
    disclaimer: string;
  };
  upliftExperiment?: UpliftExperimentMetrics;
}

export { calculateMerchantUplift, type UpliftExperimentMetrics }

/**
 * Calculates ROI and conversion rates for AI-driven offers.
 */
export async function getMerchantROI(merchantId: string): Promise<MerchantROIMetrics> {
  const parsedMerchantId = z.string().uuid().parse(merchantId)

  const [
    paidOrders,
    crossSellTotal,
    crossSellAccepted,
    upsellTotal,
    upsellAccepted,
    blockedActions,
    recoveryAttribution,
    upliftExperiment,
  ] = await Promise.all([
    prisma.order.findMany({
      where: { merchantId: parsedMerchantId, status: 'PAID' },
      select: { totalAmount: true },
    }),
    prisma.recommendation.count({
      where: { merchantId: parsedMerchantId, type: 'CROSS_SELL' }
    }),
    prisma.recommendation.count({
      where: { merchantId: parsedMerchantId, type: 'CROSS_SELL', status: { in: ['ACCEPTED', 'EXPIRED'] }, offerId: { not: null } }
    }),
    prisma.recommendation.count({
      where: { merchantId: parsedMerchantId, type: 'UPSELL' }
    }),
    prisma.recommendation.count({
      where: { merchantId: parsedMerchantId, type: 'UPSELL', status: { in: ['ACCEPTED', 'EXPIRED'] }, offerId: { not: null } }
    }),
    prisma.agentAction.findMany({
      where: { merchantId: parsedMerchantId, status: 'BLOCKED' },
      select: { policyResult: true },
    }),
    getRecoveryAttribution(parsedMerchantId),
    calculateMerchantUplift(parsedMerchantId).catch(() => undefined),
  ])

  // Get paid recommendations for incremental revenue
  const paidCrossSells = await prisma.recommendation.findMany({
    where: { merchantId: parsedMerchantId, type: 'CROSS_SELL', status: 'ACCEPTED', offer: { order: { status: 'PAID' } } },
    include: { offer: { include: { items: true } } }
  })
  let crossSellIncrementalRevenue = 0
  for (const cs of paidCrossSells) {
    const item = cs.offer?.items.filter(i => i.productId === cs.recommendedProductId).sort((a, b) => a.unitPrice - b.unitPrice)[0]
    if (item) crossSellIncrementalRevenue += item.unitPrice * item.quantity
  }
  const crossSellPaid = paidCrossSells.length

  const paidUpsells = await prisma.recommendation.findMany({
    where: { merchantId: parsedMerchantId, type: 'UPSELL', status: 'ACCEPTED', offer: { order: { status: 'PAID' } } },
    include: { offer: { include: { items: true } } }
  })

  // Need original product price for upsell incremental.
  // Actually we can get original product price from Product table.
  const allProductIds = paidUpsells.map(u => u.originalProductId).filter(Boolean) as string[]
  const originalProducts = await prisma.product.findMany({ where: { id: { in: allProductIds } } })
  const originalProductPriceMap = new Map(originalProducts.map(p => [p.id, p.price]))

  let upsellIncrementalRevenue = 0
  for (const u of paidUpsells) {
    const item = u.offer?.items.filter(i => i.productId === u.recommendedProductId).sort((a, b) => a.unitPrice - b.unitPrice)[0]
    const originalPrice = u.originalProductId ? (originalProductPriceMap.get(u.originalProductId) ?? 0) : 0
    if (item) {
      // Incremental revenue is the difference they paid for the upsell vs the original
      upsellIncrementalRevenue += (item.unitPrice - originalPrice) * item.quantity
    }
  }
  const upsellPaid = paidUpsells.length

  const totalRevenueGenerated = paidOrders.reduce((sum, order) => sum + order.totalAmount, 0)
  const crossSellPaidRate = crossSellTotal > 0 ? (crossSellPaid / crossSellTotal) * 100 : 0
  const upsellPaidRate = upsellTotal > 0 ? (upsellPaid / upsellTotal) * 100 : 0
  const aiRecoveredRevenue = recoveryAttribution.revenue
  const abandonedCartsRecovered = recoveryAttribution.recoveredOrders
  // "Margins Protected" previously counted every blocked action, even though
  // AgentAction BLOCKED currently represents a failed discount-policy check.
  // Read the recorded policy result so this metric states exactly what it is.
  const blockedDiscountPolicyRequests = blockedActions.filter((action) => {
    if (!action.policyResult || typeof action.policyResult !== 'object' || Array.isArray(action.policyResult)) return false
    const policy = action.policyResult as { passed?: unknown; checked?: unknown }
    return policy.passed === false && Array.isArray(policy.checked) && policy.checked.includes('MAX_DISCOUNT_PERCENTAGE')
  }).length

  const totalAiAttributedRevenue = aiRecoveredRevenue + crossSellIncrementalRevenue + upsellIncrementalRevenue

  return {
    totalRevenueGenerated,
    abandonedCartsRecovered,
    crossSellPaidRate,
    crossSellTotal,
    crossSellAccepted,
    crossSellPaid,
    crossSellIncrementalRevenue,
    upsellPaidRate,
    upsellTotal,
    upsellAccepted,
    upsellPaid,
    upsellIncrementalRevenue,
    totalAiAttributedRevenue,
    blockedDiscountPolicyRequests,
    aiRecoveredRevenue,
    attributionMethodology: {
      model: 'OBSERVATIONAL_DIRECT_ATTRIBUTION',
      disclaimer: 'This calculation reflects observational direct attribution and is not a randomized controlled experiment. Results may include selection bias.',
    },
    upliftExperiment,
  }
}

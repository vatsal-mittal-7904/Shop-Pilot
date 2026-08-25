import { prisma } from '@/backend/db/prisma'
import { z } from 'zod'

export type MerchantROIMetrics = {
  totalRevenueGenerated: number;
  abandonedCartsRecovered: number;
  bundleUpsellConversionRate: number;
  bundleTotal: number;
  blockedPolicyViolations: number;
  aiRecoveredRevenue: number;
}

/**
 * Calculates ROI and conversion rates for AI-driven offers.
 * 
 * Deliberately NOT a 'use server' action so it cannot be called from the client
 * with an arbitrary merchantId. It must only be called from trusted server
 * contexts that resolve the merchantId securely.
 */
export async function getMerchantROI(merchantId: string): Promise<MerchantROIMetrics> {
  const parsedMerchantId = z.string().uuid().parse(merchantId)

  // Execute all aggregations concurrently
  const [
    paidOrdersAgg,
    abandonedCartsRecovered,
    bundleTotal,
    bundlePaid,
    blockedPolicyViolations,
    merchant
  ] = await Promise.all([
    // 1. Total Revenue Generated
    prisma.order.aggregate({
      where: { merchantId: parsedMerchantId, status: 'PAID' },
      _sum: { totalAmount: true }
    }),
    // 2. Abandoned Carts Recovered
    prisma.cart.count({
      where: { merchantId: parsedMerchantId, status: 'CONVERTED' }
    }),
    // 3. Bundle Upsell Total (excluding ACTIVE)
    prisma.offer.count({
      where: {
        merchantId: parsedMerchantId,
        cartId: { not: null },
        status: { not: 'ACTIVE' },
      }
    }),
    // 3b. Bundle Paid
    prisma.offer.count({
      where: {
        merchantId: parsedMerchantId,
        cartId: { not: null },
        status: { not: 'ACTIVE' },
        order: { status: 'PAID' }
      }
    }),
    // 4. Profit Margins Protected
    prisma.agentAction.count({
      where: { merchantId: parsedMerchantId, status: 'BLOCKED' }
    }),
    // 5. AI Recovered Revenue
    prisma.merchant.findUnique({
      where: { id: parsedMerchantId },
      select: { aiRecoveredRevenue: true }
    })
  ])

  const totalRevenueGenerated = paidOrdersAgg._sum.totalAmount || 0
  const bundleUpsellConversionRate = bundleTotal > 0 ? (bundlePaid / bundleTotal) * 100 : 0
  const aiRecoveredRevenue = merchant?.aiRecoveredRevenue || 0

  return {
    totalRevenueGenerated,
    abandonedCartsRecovered,
    bundleUpsellConversionRate,
    bundleTotal,
    blockedPolicyViolations,
    aiRecoveredRevenue,
  }
}

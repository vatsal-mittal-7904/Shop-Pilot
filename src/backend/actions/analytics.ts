import { prisma } from '@/backend/db/prisma'

/**
 * Calculates ROI and conversion rates for AI-driven offers.
 * 
 * Deliberately NOT a 'use server' action so it cannot be called from the client
 * with an arbitrary merchantId. It must only be called from trusted server
 * contexts that resolve the merchantId securely.
 */
export async function getMerchantROI(merchantId: string) {
  // 1. Total Revenue Generated
  const paidOrdersAgg = await prisma.order.aggregate({
    where: { merchantId, status: 'PAID' },
    _sum: { totalAmount: true }
  })
  const totalRevenueGenerated = paidOrdersAgg._sum.totalAmount || 0

  // 2. Abandoned Carts Recovered
  const abandonedCartsRecovered = await prisma.cart.count({
    where: { merchantId, status: 'CONVERTED' }
  })

  // 3. Bundle Upsell Conversion Rate
  // We exclude ACTIVE offers entirely rather than counting them as failures,
  // so merchants with a healthy in-flight pipeline don't see an artificially depressed rate.
  const bundleOffers = await prisma.offer.findMany({
    where: {
      merchantId,
      cartId: { not: null },
      status: { not: 'ACTIVE' },
    },
    include: {
      order: true,
    },
  })

  const bundleTotal = bundleOffers.length
  // Accepted and paid is judged via the linked Order.status, not Offer.status.
  const bundlePaid = bundleOffers.filter((o) => o.order?.status === 'PAID').length
  const bundleUpsellConversionRate = bundleTotal > 0 ? (bundlePaid / bundleTotal) * 100 : 0

  // 4. Profit Margins Protected (Number of blocked policy violations)
  const blockedPolicyViolations = await prisma.agentAction.count({
    where: { merchantId, status: 'BLOCKED' }
  })

  // 5. Get AI Recovered Revenue for the impact bar
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { aiRecoveredRevenue: true }
  })
  const aiRecoveredRevenue = merchant?.aiRecoveredRevenue || 0

  return {
    totalRevenueGenerated,
    abandonedCartsRecovered,
    bundleUpsellConversionRate,
    blockedPolicyViolations,
    aiRecoveredRevenue,
  }
}

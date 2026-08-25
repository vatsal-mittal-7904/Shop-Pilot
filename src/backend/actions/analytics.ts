import { prisma } from '@/backend/db/prisma'

/**
 * Calculates ROI and conversion rates for AI-driven offers.
 * 
 * Deliberately NOT a 'use server' action so it cannot be called from the client
 * with an arbitrary merchantId. It must only be called from trusted server
 * contexts that resolve the merchantId securely.
 */
export async function getMerchantROI(merchantId: string) {
  // We exclude ACTIVE offers entirely rather than counting them as failures,
  // so merchants with a healthy in-flight pipeline don't see an artificially depressed rate.
  
  // 1. Bundle offers: cartId is populated by the cart/add-on flow.
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

  // 2. Intent offers: driven by BuyerIntent, cartId is null.
  const intentOffers = await prisma.offer.findMany({
    where: {
      merchantId,
      cartId: null,
      status: { not: 'ACTIVE' },
    },
    include: {
      order: true,
    },
  })

  const bundleTotal = bundleOffers.length
  // Accepted and paid is judged via the linked Order.status, not Offer.status.
  const bundlePaid = bundleOffers.filter((o) => o.order?.status === 'PAID').length
  const bundleConversionRate = bundleTotal > 0 ? bundlePaid / bundleTotal : 0

  const intentTotal = intentOffers.length
  const intentPaid = intentOffers.filter((o) => o.order?.status === 'PAID').length
  const intentConversionRate = intentTotal > 0 ? intentPaid / intentTotal : 0

  return {
    bundle: { total: bundleTotal, paid: bundlePaid, conversionRate: bundleConversionRate },
    intent: { total: intentTotal, paid: intentPaid, conversionRate: intentConversionRate },
  }
}

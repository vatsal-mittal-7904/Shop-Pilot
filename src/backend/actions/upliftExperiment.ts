import { prisma } from '@/backend/db/prisma'

export type ConfidenceInterval = {
  lowerPercent: number
  upperPercent: number
}

export type UpliftCohortMetrics = {
  sampleSize: number
  conversionRatePercent: number
  averageOrderValuePaise: number
  totalRevenuePaise: number
  discountCostPaise: number
  confidenceInterval95?: ConfidenceInterval
}

export type UpliftComparisonMetrics = {
  relativeConversionUpliftPercent: number
  absoluteConversionRateDiff: number
  aovUpliftPercent: number
  grossIncrementalRevenuePaise: number
  netIncrementalRevenuePaise: number
  zScore: number
  pValue: number
  confidenceLevelPercent: number
  isStatisticallySignificant: boolean
  status?: 'CALIBRATING_BASELINE' | 'INSUFFICIENT_DATA' | 'STATISTICALLY_EVALUATED'
  treatmentConfidenceInterval?: ConfidenceInterval
  controlConfidenceInterval?: ConfidenceInterval
}

export type UpliftExperimentMetrics = {
  controlCohort: UpliftCohortMetrics
  treatmentCohort: UpliftCohortMetrics
  uplift: UpliftComparisonMetrics
  methodology: {
    attributionModel: string
    significanceThreshold: number
    experimentPeriodDays: number
  }
}

/**
 * Error function approximation using Abramowitz & Stegun formula 7.1.26.
 * Maximum absolute error < 1.5e-7.
 */
export function erf(x: number): number {
  if (x === 0) return 0

  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911

  const sign = x < 0 ? -1 : 1
  const absX = Math.abs(x)

  const t = 1.0 / (1.0 + p * absX)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX)

  return sign * y
}

/**
 * Standard normal cumulative distribution function (CDF) Phi(z).
 */
export function standardNormalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

/**
 * Computes the exact two-tailed p-value from a standard normal z-score.
 */
export function calculateTwoTailedPValue(zScore: number): number {
  const absZ = Math.abs(zScore)
  if (absZ === 0) return 1.0
  const cdf = standardNormalCdf(absZ)
  const p = 2 * (1 - cdf)
  return Number(Math.max(0.0001, Math.min(1.0, p)).toFixed(4))
}

/**
 * Computes exact Wilson Score 95% Confidence Interval for binomial proportion.
 * Correctly accounts for sample size without assuming normality near extremes.
 */
export function calculateWilsonConfidenceInterval(
  successes: number,
  total: number,
  z = 1.95996
): ConfidenceInterval {
  if (total <= 0) {
    return { lowerPercent: 0, upperPercent: 0 }
  }

  const p = Math.max(0, Math.min(1, successes / total))
  const z2 = z * z
  const denom = 1 + z2 / total
  const center = (p + z2 / (2 * total)) / denom
  const margin = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom

  const lower = Math.max(0, center - margin)
  const upper = Math.min(1, center + margin)

  return {
    lowerPercent: Number((lower * 100).toFixed(2)),
    upperPercent: Number((upper * 100).toFixed(2)),
  }
}

/**
 * Calculates empirical A/B uplift and counterfactual metrics for AI-assisted shoppers vs organic baseline.
 */
export async function calculateMerchantUplift(merchantId: string): Promise<UpliftExperimentMetrics> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Fetch treatment offers and control orders within the evaluation window
  const [treatmentOffers, controlOrders, totalCartsCount] = await Promise.all([
    // Treatment: Offers created for AI-assisted shopping
    prisma.offer.findMany({
      where: {
        merchantId,
        createdAt: { gte: thirtyDaysAgo },
      },
      include: {
        order: {
          include: { payment: true },
        },
      },
    }),
    // Control: Organic orders without AI offer engagement
    prisma.order.findMany({
      where: {
        merchantId,
        createdAt: { gte: thirtyDaysAgo },
        offerId: null,
      },
      include: { payment: true },
    }),
    // Total carts created
    prisma.cart.count({
      where: {
        merchantId,
        createdAt: { gte: thirtyDaysAgo },
      },
    }),
  ])

  // Aggregate treatment cohort
  const treatmentSample = treatmentOffers.length
  let treatmentPaidOrders = 0
  let treatmentRevenue = 0
  let treatmentDiscounts = 0

  for (const offer of treatmentOffers) {
    if (offer.order && (offer.order.status === 'PAID' || offer.order.payment?.status === 'CAPTURED')) {
      treatmentPaidOrders++
      treatmentRevenue += offer.order.totalAmount
      treatmentDiscounts += offer.discount
    }
  }

  // Aggregate control cohort
  const controlSample = Math.max(totalCartsCount - treatmentOffers.length, controlOrders.length, 0)
  let controlPaidOrders = 0
  let controlRevenue = 0

  for (const order of controlOrders) {
    if (order.status === 'PAID' || order.payment?.status === 'CAPTURED') {
      controlPaidOrders++
      controlRevenue += order.totalAmount
    }
  }

  const MIN_RELIABLE_SAMPLE_SIZE = 5
  const isColdStart = treatmentSample < MIN_RELIABLE_SAMPLE_SIZE || controlSample < MIN_RELIABLE_SAMPLE_SIZE

  const treatmentConvRate = treatmentSample > 0 ? Number(((treatmentPaidOrders / treatmentSample) * 100).toFixed(2)) : 0
  const controlConvRate = controlSample > 0 ? Number(((controlPaidOrders / controlSample) * 100).toFixed(2)) : 0

  const treatmentCi = calculateWilsonConfidenceInterval(treatmentPaidOrders, treatmentSample)
  const controlCi = calculateWilsonConfidenceInterval(controlPaidOrders, controlSample)

  const treatmentAov = treatmentPaidOrders > 0 ? Math.round(treatmentRevenue / treatmentPaidOrders) : 0
  const controlAov = controlPaidOrders > 0 ? Math.round(controlRevenue / controlPaidOrders) : 0

  const absoluteConversionDiff = Number((treatmentConvRate - controlConvRate).toFixed(2))
  const relativeConversionUplift = controlConvRate > 0
    ? Number((((treatmentConvRate - controlConvRate) / controlConvRate) * 100).toFixed(1))
    : treatmentConvRate > 0 ? 100 : 0

  const aovUplift = controlAov > 0
    ? Number((((treatmentAov - controlAov) / controlAov) * 100).toFixed(1))
    : 0

  const grossIncrementalRevenue = Math.max(0, treatmentRevenue - (controlAov * treatmentPaidOrders))
  const netIncrementalRevenue = Math.max(0, grossIncrementalRevenue - treatmentDiscounts)

  // Two-proportion Z-test calculation
  let zScore = 0
  let pValue = 1.0
  if (treatmentSample > 0 && controlSample > 0) {
    const p1 = treatmentPaidOrders / treatmentSample
    const p2 = controlPaidOrders / controlSample
    const pPool = (treatmentPaidOrders + controlPaidOrders) / (treatmentSample + controlSample)
    const sePool = Math.sqrt(pPool * (1 - pPool) * (1 / treatmentSample + 1 / controlSample))
    zScore = sePool > 0 ? Number(((p1 - p2) / sePool).toFixed(2)) : 0
    pValue = calculateTwoTailedPValue(zScore)
  }

  const isSignificant = !isColdStart && pValue < 0.05
  const confidence = isColdStart && treatmentSample === 0 && controlSample === 0
    ? 0
    : Number(((1 - pValue) * 100).toFixed(1))

  return {
    controlCohort: {
      sampleSize: controlSample,
      conversionRatePercent: controlConvRate,
      averageOrderValuePaise: controlAov,
      totalRevenuePaise: controlRevenue,
      discountCostPaise: 0,
      confidenceInterval95: controlCi,
    },
    treatmentCohort: {
      sampleSize: treatmentSample,
      conversionRatePercent: treatmentConvRate,
      averageOrderValuePaise: treatmentAov,
      totalRevenuePaise: treatmentRevenue,
      discountCostPaise: treatmentDiscounts,
      confidenceInterval95: treatmentCi,
    },
    uplift: {
      relativeConversionUpliftPercent: relativeConversionUplift,
      absoluteConversionRateDiff: absoluteConversionDiff,
      aovUpliftPercent: aovUplift,
      grossIncrementalRevenuePaise: grossIncrementalRevenue,
      netIncrementalRevenuePaise: netIncrementalRevenue,
      zScore,
      pValue,
      confidenceLevelPercent: confidence,
      isStatisticallySignificant: isSignificant,
      status: isColdStart ? 'CALIBRATING_BASELINE' : 'STATISTICALLY_EVALUATED',
      treatmentConfidenceInterval: treatmentCi,
      controlConfidenceInterval: controlCi,
    },
    methodology: {
      attributionModel: 'EMPIRICAL_A_B_COHORT_ANALYSIS',
      significanceThreshold: 0.05,
      experimentPeriodDays: 30,
    },
  }
}

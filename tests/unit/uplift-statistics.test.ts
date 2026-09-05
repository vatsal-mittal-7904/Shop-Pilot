import { describe, expect, it, vi } from 'vitest'
import {
  erf,
  standardNormalCdf,
  calculateTwoTailedPValue,
  calculateWilsonConfidenceInterval,
  calculateMerchantUplift,
} from '@/backend/actions/upliftExperiment'
import { prisma } from '@/backend/db/prisma'

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    offer: { findMany: vi.fn() },
    order: { findMany: vi.fn() },
    cart: { count: vi.fn() },
  },
}))

describe('A/B Uplift Engine - Mathematical & Statistical Rigor', () => {
  it('computes erf with high numerical precision against known constants', () => {
    // erf(0) = 0
    expect(erf(0)).toBe(0)
    // erf(1) ≈ 0.84270079
    expect(erf(1)).toBeCloseTo(0.8427, 4)
    // erf(-1) = -erf(1)
    expect(erf(-1)).toBeCloseTo(-0.8427, 4)
    // erf(2) ≈ 0.99532226
    expect(erf(2)).toBeCloseTo(0.9953, 4)
  })

  it('computes standard normal cumulative distribution function (CDF) correctly', () => {
    // Phi(0) = 0.5 (mean)
    expect(standardNormalCdf(0)).toBeCloseTo(0.5, 4)
    // Phi(1.96) ≈ 0.9750 (critical 95% value)
    expect(standardNormalCdf(1.96)).toBeCloseTo(0.9750, 4)
    // Phi(2.576) ≈ 0.9950 (critical 99% value)
    expect(standardNormalCdf(2.576)).toBeCloseTo(0.9950, 3)
    // Phi(-1.96) ≈ 0.0250
    expect(standardNormalCdf(-1.96)).toBeCloseTo(0.0250, 4)
  })

  it('calculates exact two-tailed p-values from z-scores', () => {
    // z = 0 -> p = 1.0 (no difference)
    expect(calculateTwoTailedPValue(0)).toBe(1.0)
    // z = 1.96 -> p ≈ 0.0500 (standard alpha = 0.05 cutoff)
    expect(calculateTwoTailedPValue(1.96)).toBeCloseTo(0.05, 2)
    // z = 2.58 -> p ≈ 0.0099 (< 0.01)
    expect(calculateTwoTailedPValue(2.58)).toBeCloseTo(0.0099, 3)
    // z = 3.29 -> p ≈ 0.0010 (< 0.001)
    expect(calculateTwoTailedPValue(3.29)).toBeCloseTo(0.001, 3)
    // Negative z-scores should yield identical two-tailed p-value
    expect(calculateTwoTailedPValue(-1.96)).toBe(calculateTwoTailedPValue(1.96))
  })

  it('calculates Wilson score 95% confidence intervals properly', () => {
    // Empty sample
    const emptyCi = calculateWilsonConfidenceInterval(0, 0)
    expect(emptyCi.lowerPercent).toBe(0)
    expect(emptyCi.upperPercent).toBe(0)

    // 10 out of 100 conversions (10%)
    // Expected Wilson 95% interval is approx [5.52%, 17.44%]
    const ci100 = calculateWilsonConfidenceInterval(10, 100)
    expect(ci100.lowerPercent).toBeGreaterThan(4.5)
    expect(ci100.lowerPercent).toBeLessThan(6.5)
    expect(ci100.upperPercent).toBeGreaterThan(16.0)
    expect(ci100.upperPercent).toBeLessThan(18.5)

    // 0 out of 50 conversions (0%)
    // Upper bound should be positive non-zero even with 0 successes (rule of 3 / Wilson bound)
    const ciZero = calculateWilsonConfidenceInterval(0, 50)
    expect(ciZero.lowerPercent).toBe(0)
    expect(ciZero.upperPercent).toBeGreaterThan(0)
    expect(ciZero.upperPercent).toBeLessThan(10)

    // 50 out of 50 conversions (100%)
    const ciFull = calculateWilsonConfidenceInterval(50, 50)
    expect(ciFull.lowerPercent).toBeGreaterThan(90)
    expect(ciFull.upperPercent).toBe(100)
  })

  it('calibrates cold-start baseline without inventing fake samples', async () => {
    vi.mocked(prisma.offer.findMany).mockResolvedValue([])
    vi.mocked(prisma.order.findMany).mockResolvedValue([])
    vi.mocked(prisma.cart.count).mockResolvedValue(0)

    const result = await calculateMerchantUplift('merchant-cold')
    expect(result.treatmentCohort.sampleSize).toBe(0)
    expect(result.controlCohort.sampleSize).toBe(0)
    expect(result.treatmentCohort.conversionRatePercent).toBe(0)
    expect(result.controlCohort.conversionRatePercent).toBe(0)
    expect(result.uplift.status).toBe('CALIBRATING_BASELINE')
    expect(result.uplift.isStatisticallySignificant).toBe(false)
    expect(result.treatmentCohort.confidenceInterval95).toEqual({ lowerPercent: 0, upperPercent: 0 })
  })

  it('computes statistically sound uplift and Wilson CI when sample thresholds are met', async () => {
    // 20 treatment offers, 10 converted
    const mockOffers = Array.from({ length: 20 }, (_, i) => ({
      id: `off-${i}`,
      discount: 5000,
      order: i < 10 ? { status: 'PAID', totalAmount: 50000, payment: { status: 'CAPTURED' } } : null,
    }))
    // 20 control orders, 4 converted
    const mockOrders = Array.from({ length: 20 }, (_, i) => ({
      id: `ord-${i}`,
      status: i < 4 ? 'PAID' : 'PENDING',
      totalAmount: 40000,
      payment: { status: i < 4 ? 'CAPTURED' : 'CREATED' },
    }))

    vi.mocked(prisma.offer.findMany).mockResolvedValue(mockOffers as unknown as never)
    vi.mocked(prisma.order.findMany).mockResolvedValue(mockOrders as unknown as never)
    vi.mocked(prisma.cart.count).mockResolvedValue(40)

    const result = await calculateMerchantUplift('merchant-active')
    expect(result.treatmentCohort.sampleSize).toBe(20)
    expect(result.treatmentCohort.conversionRatePercent).toBe(50) // 10 / 20 = 50%
    expect(result.controlCohort.sampleSize).toBe(20)
    expect(result.controlCohort.conversionRatePercent).toBe(20) // 4 / 20 = 20%
    expect(result.uplift.status).toBe('STATISTICALLY_EVALUATED')
    expect(result.uplift.relativeConversionUpliftPercent).toBe(150) // (50 - 20) / 20 * 100
    expect(result.treatmentCohort.confidenceInterval95?.lowerPercent).toBeGreaterThan(25)
    expect(result.treatmentCohort.confidenceInterval95?.upperPercent).toBeLessThan(75)
  })
})


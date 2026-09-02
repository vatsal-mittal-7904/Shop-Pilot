import { generateObject } from 'ai'
import { z } from 'zod'
import { prisma } from '@/backend/db/prisma'
import { aiModel } from '@/backend/ai/model'
import {
  gatherMerchantTelemetry,
  generateAnalyticalCampaignProposals,
  Opportunity,
} from '@/backend/actions/campaignProposalEngine'

const strategyProposalSchema = z.object({
  strategicDiagnosis: z.string().describe('Executive summary of merchant operational bottlenecks and growth opportunities'),
  recoveryProposal: z.object({
    title: z.string().describe('Action-oriented title for abandoned basket recovery campaign'),
    recommendedDiscountPercent: z.number().min(0).max(50).describe('Optimal price-elasticity discount percentage'),
    rationale: z.string().describe('In-depth strategic reasoning citing quantitative basket telemetry and expected conversion'),
    projectedRecoveryRate: z.string().describe('Estimated cohort conversion rate, e.g. 25-30%'),
  }).optional(),
  clearanceProposal: z.object({
    title: z.string().describe('Clearance campaign title focusing on capital velocity'),
    recommendedDiscountPercent: z.number().min(0).max(50).describe('Optimal discount percentage for dead stock liquidation'),
    rationale: z.string().describe('Strategic reasoning analyzing holding costs, working capital release, and margin preservation'),
  }).optional(),
})

/**
 * Model-Derived AI Growth Strategy Engine:
 * Ingests live merchant telemetry (abandoned baskets, dead stock, customer purchase cohorts,
 * gross margins) and employs model intelligence to synthesize data-grounded growth strategies,
 * while strictly enforcing deterministic merchant policy boundaries.
 */
export async function generateModelDerivedCampaignProposals(merchantId: string): Promise<Opportunity[]> {
  try {
    const telemetry = await gatherMerchantTelemetry(merchantId)
    const { abandonedCarts, slowMovingInventory, customerCohorts, policies } = telemetry
    const maxBudget = policies.CAMPAIGN_BUDGET_LIMIT ?? 10000000
    const maxDiscount = policies.MAX_DISCOUNT_PERCENTAGE ?? 15
    const minMargin = policies.MIN_MARGIN_PERCENTAGE ?? 10

    // Only attempt LLM generation if there is telemetry to strategize over and credentials exist
    const hasData = abandonedCarts.count > 0 || slowMovingInventory.length > 0
    const hasApiKey = Boolean(process.env.GROQ_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY)

    let modelStrategy: z.infer<typeof strategyProposalSchema> | null = null

    if (hasData && hasApiKey) {
      try {
        const prompt = `You are the Chief AI Growth Officer for TechNest Commerce.
Analyze the following merchant telemetry and synthesize high-ROI, policy-safe promotional campaigns:

MERCHANT TELEMETRY:
- Abandoned Baskets: ${abandonedCarts.count} carts totaling ₹${(abandonedCarts.totalValue / 100).toLocaleString('en-IN')}, avg age: ${abandonedCarts.avgAgeMinutes} minutes, avg basket value: ₹${Math.round(abandonedCarts.totalValue / (abandonedCarts.count || 1) / 100).toLocaleString('en-IN')}.
- Slow-Moving Inventory: ${slowMovingInventory.map(p => `"${p.name}" (${p.inventory} units @ ₹${p.price / 100}, cost: ₹${p.cost / 100}, category: ${p.category})`).join(', ') || 'None'}.
- Customer Cohorts: ${customerCohorts.repeatCustomerCount} repeat purchasers out of ${customerCohorts.totalCustomers} total customer accounts.
- Policy Guardrails: Max allowed discount ceiling is ${maxDiscount}%, Max campaign budget is ₹${maxBudget / 100}, Min margin floor is ${minMargin}%.

INSTRUCTIONS:
1. For Abandoned Carts: Formulate a dynamic recovery campaign. Recommend an optimal discount % bounded by max discount (${maxDiscount}%). Younger carts (<60m) need smaller incentives (5-8%), while older carts (>120m) may require 10-${maxDiscount}%.
2. For Slow-Moving Inventory: Formulate a capital velocity clearance campaign targeting qualified repeat buyers. Preserve at least ${minMargin}% post-discount gross margin.
3. Provide rigorous, quantitative business justifications citing exact numbers.`

        const response = await generateObject({
          model: aiModel(),
          schema: strategyProposalSchema,
          prompt,
          temperature: 0.2,
        })
        modelStrategy = response.object
      } catch (llmErr) {
        console.warn('[AI_GROWTH_STRATEGIST:LLM_FALLBACK] LLM call unavailable, using analytical model reasoning:', llmErr)
      }
    }

    if (!modelStrategy) {
      throw new Error('LLM failed to generate a campaign strategy.')
    }

    const opportunities: Opportunity[] = []

    // 1. Synthesize Strategy for Abandoned Cart Recovery
    if (abandonedCarts.count > 0 && modelStrategy.recoveryProposal) {
      const avgValue = abandonedCarts.totalValue / abandonedCarts.count
      
      const suggestedDiscount = modelStrategy.recoveryProposal.recommendedDiscountPercent
      const optimalDiscount = Math.min(Math.max(1, Math.round(suggestedDiscount)), maxDiscount)
      const estimatedImpact = abandonedCarts.totalValue
      const budget = Math.floor(estimatedImpact * (optimalDiscount / 100))
      const projectedRecoveryRate = modelStrategy.recoveryProposal.projectedRecoveryRate
      const rationale = modelStrategy.recoveryProposal.rationale
      const title = modelStrategy.recoveryProposal.title

      opportunities.push({
        id: 'abandoned-cart',
        title,
        type: 'RECOVERY',
        estimatedImpact,
        budget,
        reason: rationale,
        configuration: {
          cartIds: abandonedCarts.cartIds,
          discountPercent: optimalDiscount,
          avgCartValuePaise: Math.round(avgValue),
          projectedRecoveryRate,
          modelStrategized: true,
        },
        policy: {
          allowed: budget <= maxBudget,
          reason:
            budget <= maxBudget
              ? `Campaign budget of ₹${(budget / 100).toLocaleString('en-IN')} is within merchant limits.`
              : `Campaign budget of ₹${(budget / 100).toLocaleString('en-IN')} exceeds the ₹${(
                  maxBudget / 100
                ).toLocaleString('en-IN')} limit.`,
        },
      })
    }

    // 2. Synthesize Strategy for Dead Inventory & High Holding Exposure
    if (slowMovingInventory.length > 0 && modelStrategy.clearanceProposal) {
      const targetProduct = slowMovingInventory[0]
      const suggestedClearanceDiscount = modelStrategy.clearanceProposal.recommendedDiscountPercent
      
      const clearanceDiscount = Math.min(Math.max(1, Math.round(suggestedClearanceDiscount)), maxDiscount)

      const recipients = await prisma.customer.findMany({
        where: {
          orders: {
            some: { merchantId, status: 'PAID' },
            none: { merchantId, items: { some: { productId: targetProduct.productId } } },
          },
        },
        select: { id: true },
        take: 100,
      })

      if (recipients.length > 0) {
        const estimatedImpact = targetProduct.price * recipients.length
        const budget = Math.floor(estimatedImpact * (clearanceDiscount / 100))
        const effectiveSellingPrice = Math.round(targetProduct.price * (1 - clearanceDiscount / 100))
        const postDiscountMargin =
          effectiveSellingPrice > 0
            ? Math.round(((effectiveSellingPrice - targetProduct.cost) / effectiveSellingPrice) * 100)
            : 0

        const rationale = modelStrategy?.clearanceProposal?.rationale
          ?? `AI Stock Velocity Analysis detected holding exposure on "${
              targetProduct.name
            }" (${targetProduct.inventory} units in stock, category: ${
              targetProduct.category
            }). Proposing a targeted ${clearanceDiscount}% inventory liquidation incentive to ${
              recipients.length
            } qualified repeat buyers (${customerCohorts.repeatCustomerCount} active repeat purchasers). This yields ₹${(
              estimatedImpact / 100
            ).toLocaleString('en-IN')} in working capital recovery while locking in a profitable ${postDiscountMargin}% gross margin (floor: ${minMargin}%).`

        const title = modelStrategy?.clearanceProposal?.title
          ?? `Capital Velocity Clearance: ${targetProduct.name} (${clearanceDiscount}% Off)`

        opportunities.push({
          id: 'clearance',
          title,
          type: 'CLEARANCE',
          estimatedImpact,
          budget,
          reason: rationale,
          configuration: {
            productId: targetProduct.productId,
            customerIds: recipients.map((r) => r.id),
            discountPercent: clearanceDiscount,
            capitalRecoveryPaise: estimatedImpact,
            postDiscountMargin,
            modelStrategized: Boolean(modelStrategy),
          },
          policy: {
            allowed: budget <= maxBudget && postDiscountMargin >= minMargin,
            reason:
              budget <= maxBudget && postDiscountMargin >= minMargin
                ? `Clearance budget of ₹${(budget / 100).toLocaleString(
                    'en-IN'
                  )} and ${postDiscountMargin}% margin satisfy merchant policy.`
                : `Clearance parameters exceed merchant policy bounds.`,
          },
        })
      }
    }

    return opportunities
  } catch (err) {
    console.warn('[AI_CAMPAIGN_STRATEGY:FALLBACK] Falling back to quantitative baseline:', err)
    return generateAnalyticalCampaignProposals(merchantId)
  }
}

import { prisma } from '@/backend/db/prisma'
import { Prisma, Product } from '@prisma/client'
import { generateObject } from 'ai'
import { z } from 'zod'
import { executeWithFallback } from '@/backend/ai/model'

export type CandidateReasoning = {
  categoryMatch: string
  inventoryDepth: string
  marginHealth: string
  compatibilityReason: string
  compositeScore?: number
  synergyScore?: number
  tradeOffAnalysis?: string
}

export type RecommendationCandidate = {
  product: Product
  sourceProduct: Product
  reasoning: CandidateReasoning
}

// Category affinity matrix for dynamic complementary discovery
const COMPLEMENTARY_CATEGORY_MAP: Record<string, string[]> = {
  keyboards: ['keycaps', 'wrist rests', 'cables', 'mice', 'desk mats', 'accessories'],
  mice: ['mousepads', 'desk mats', 'cables', 'keyboards', 'accessories'],
  audio: ['stands', 'adapters', 'cables', 'microphones', 'accessories'],
  monitors: ['monitor arms', 'light bars', 'cables', 'cleaning kits', 'accessories'],
  laptops: ['laptop stands', 'hubs', 'sleeves', 'chargers', 'cables'],
}

/**
 * Baseline fallback calculator if the AI API is unavailable.
 */
function calculateCandidateScore(params: {
  candidate: Product
  sourceProduct: Product
  isStaticMatch: boolean
  isCrossSell: boolean
}) {
  const { candidate, sourceProduct, isStaticMatch, isCrossSell } = params

  let synergyScore = 0
  if (isStaticMatch) synergyScore = 100
  else if (candidate.category === sourceProduct.category) synergyScore = isCrossSell ? 60 : 90
  else synergyScore = 75

  const grossMarginPercent = candidate.price > 0 ? Math.round(((candidate.price - candidate.cost) / candidate.price) * 100) : 0
  const marginScore = Math.min(100, Math.max(0, grossMarginPercent * 2.5))
  const inventoryScore = Math.min(100, Math.max(0, (candidate.inventory / 100) * 100))
  
  let priceRatioScore = 50
  if (isCrossSell && sourceProduct.price > 0) {
    const ratio = candidate.price / sourceProduct.price
    if (ratio >= 0.10 && ratio <= 0.40) priceRatioScore = 100
    else if (ratio < 0.10) priceRatioScore = 80
    else priceRatioScore = Math.max(20, Math.round(100 - (ratio - 0.40) * 100))
  } else if (!isCrossSell && sourceProduct.price > 0) {
    const multiplier = candidate.price / sourceProduct.price
    if (multiplier >= 1.10 && multiplier <= 1.60) priceRatioScore = 100
    else priceRatioScore = Math.max(30, Math.round(100 - Math.abs(multiplier - 1.35) * 50))
  }

  const compositeScore = Math.round(0.35 * synergyScore + 0.30 * marginScore + 0.20 * inventoryScore + 0.15 * priceRatioScore)
  return { compositeScore, synergyScore, marginScore, inventoryScore, priceRatioScore, grossMarginPercent }
}

const aiRecommendationSchema = z.object({
  selectedCandidateId: z.string(),
  reasoning: z.object({
    synergyScore: z.number().min(0).max(100),
    tradeOffAnalysis: z.string(),
    compatibilityReason: z.string(),
  })
})

export async function findIntelligentCrossSellCandidate(
  merchantId: string,
  cartItems: Array<{ productId: string; product: Product }>,
  excludedProductIds: Set<string>
): Promise<RecommendationCandidate | null> {
  const cartProductIds = new Set(cartItems.map((item) => item.productId))
  const candidatePool: Array<{ candidate: Product; sourceProduct: Product; isStatic: boolean }> = []

  // 1. Static candidates
  for (const item of cartItems) {
    const staticIds = item.product.complementaryProducts?.filter(id => !cartProductIds.has(id) && !excludedProductIds.has(id)) ?? []
    for (const sid of staticIds) {
      const candidate = await prisma.product.findUnique({ where: { id: sid, merchantId } })
      if (candidate && candidate.inventory > 0) candidatePool.push({ candidate, sourceProduct: item.product, isStatic: true })
    }
  }

  // 1.5 Empirical Co-Purchase Candidates: Products previously purchased in PAID orders alongside current cart items
  try {
    const historicalOrders = await prisma.order.findMany({
      where: {
        merchantId,
        status: 'PAID',
        items: { some: { productId: { in: Array.from(cartProductIds) } } },
      },
      select: {
        items: {
          select: { productId: true },
        },
      },
      take: 50,
    })

    const coPurchaseFrequency = new Map<string, number>()
    for (const order of historicalOrders) {
      for (const orderItem of order.items) {
        if (!cartProductIds.has(orderItem.productId) && !excludedProductIds.has(orderItem.productId)) {
          coPurchaseFrequency.set(
            orderItem.productId,
            (coPurchaseFrequency.get(orderItem.productId) || 0) + 1
          )
        }
      }
    }

    const topCoPurchaseIds = Array.from(coPurchaseFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)
      .slice(0, 5)

    if (topCoPurchaseIds.length > 0) {
      const coPurchaseProducts = await prisma.product.findMany({
        where: { id: { in: topCoPurchaseIds }, merchantId, inventory: { gt: 0 } },
      })
      for (const prod of coPurchaseProducts) {
        if (!candidatePool.some((c) => c.candidate.id === prod.id)) {
          candidatePool.push({ candidate: prod, sourceProduct: cartItems[0].product, isStatic: true })
        }
      }
    }
  } catch (coPurchaseErr) {
    console.warn('[AI_MERCHANDISER:CO_PURCHASE_FALLBACK] Failed to mine co-purchase history:', coPurchaseErr)
  }

  // 2. Dynamic category affinity candidates (for cold-start or low co-purchase depth)
  for (const item of cartItems) {
    const sourceCat = item.product.category.toLowerCase().trim()
    const mappedCats = COMPLEMENTARY_CATEGORY_MAP[sourceCat] || []
    const targetCats = Array.from(new Set([...mappedCats, 'accessories', 'accessory', 'add-on', 'addon']))

    const orConditions: Prisma.ProductWhereInput[] = [
      { category: { in: targetCats, mode: 'insensitive' } },
      { tags: { hasSome: [sourceCat, 'accessory', 'bundle', 'addon', 'add-on', ...(item.product.tags ?? [])] } },
    ]

    if (item.product.price > 0) {
      orConditions.push({
        price: {
          gte: Math.round(item.product.price * 0.05),
          lte: Math.round(item.product.price * 0.45),
        },
      })
    }

    const dyn = (await prisma.product.findMany({
      where: {
        merchantId,
        id: { notIn: Array.from(new Set([...cartProductIds, ...excludedProductIds])) },
        inventory: { gt: 0 },
        OR: orConditions,
      },
      orderBy: [{ inventory: 'desc' }, { price: 'asc' }],
      take: 12,
    })) || []
    
    for (const dynCandidate of dyn) {
      if (!candidatePool.some(c => c.candidate.id === dynCandidate.id)) {
        candidatePool.push({ candidate: dynCandidate, sourceProduct: item.product, isStatic: false })
      }
    }
  }

  if (candidatePool.length === 0) return null

  const hasApiKey = Boolean(process.env.GROQ_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY)
  
  if (hasApiKey && candidatePool.length > 1) {
    try {
      const prompt = `You are an expert AI Merchandiser. Select the absolute best cross-sell add-on product to recommend to a customer based on their current cart.

Customer Cart:
${cartItems.map(i => `- "${i.product.name}" (Category: ${i.product.category}, Price: ₹${i.product.price / 100})`).join('\n')}

Candidate Add-on Products:
${candidatePool.map(c => `- ID: ${c.candidate.id} | Name: "${c.candidate.name}" | Category: ${c.candidate.category} | Price: ₹${c.candidate.price / 100} | Cost: ₹${c.candidate.cost / 100} | Inventory: ${c.candidate.inventory}`).join('\n')}

Select the candidate that maximizes category synergy, provides a healthy gross margin (price - cost), and is priced appropriately as an add-on (ideally 10-40% of the main item price). Return the selected ID and your reasoning.`

      const { object } = await executeWithFallback((model) => generateObject({
        model,
        schema: aiRecommendationSchema,
        prompt,
        temperature: 0.1,
      }))

      const selected = candidatePool.find(c => c.candidate.id === object.selectedCandidateId)
      if (selected) {
        const gm = selected.candidate.price > 0 ? Math.round(((selected.candidate.price - selected.candidate.cost) / selected.candidate.price) * 100) : 0
        return {
          product: selected.candidate,
          sourceProduct: selected.sourceProduct,
          reasoning: {
            categoryMatch: `${selected.sourceProduct.category} & ${selected.candidate.category} synergy`,
            inventoryDepth: `${selected.candidate.inventory} units available`,
            marginHealth: `${gm}% gross margin preserved`,
            compatibilityReason: object.reasoning.compatibilityReason,
            compositeScore: object.reasoning.synergyScore,
            synergyScore: object.reasoning.synergyScore,
            tradeOffAnalysis: object.reasoning.tradeOffAnalysis,
          }
        }
      }
    } catch (err) {
      console.warn('[AI_MERCHANDISER:LLM_FALLBACK] Using analytical baseline:', err)
    }
  }

  // Fallback to baseline
  const scored = candidatePool.map(c => ({
    ...c,
    scores: calculateCandidateScore({ candidate: c.candidate, sourceProduct: c.sourceProduct, isStaticMatch: c.isStatic, isCrossSell: true })
  }))
  scored.sort((a, b) => b.scores.compositeScore - a.scores.compositeScore)
  const best = scored[0]

  return {
    product: best.candidate,
    sourceProduct: best.sourceProduct,
    reasoning: {
      categoryMatch: `${best.sourceProduct.category} & ${best.candidate.category} synergy`,
      inventoryDepth: `${best.candidate.inventory} units available`,
      marginHealth: `${best.scores.grossMarginPercent}% gross margin preserved`,
      compatibilityReason: `Selected ${best.candidate.name} to pair with ${best.sourceProduct.name}.`,
      compositeScore: best.scores.compositeScore,
      synergyScore: best.scores.synergyScore,
      tradeOffAnalysis: `High composite synergy (${best.scores.compositeScore}/100).`,
    }
  }
}

export async function findIntelligentUpsellCandidate(
  merchantId: string,
  cartItems: Array<{ productId: string; product: Product }>,
  excludedProductIds: Set<string>
): Promise<RecommendationCandidate | null> {
  const cartProductIds = new Set(cartItems.map((item) => item.productId))
  const candidatePool: Array<{ candidate: Product; sourceProduct: Product; isStatic: boolean }> = []

  for (const item of cartItems) {
    const staticIds = item.product.upgradeProducts?.filter(id => !cartProductIds.has(id) && !excludedProductIds.has(id)) ?? []
    for (const sid of staticIds) {
      const candidate = await prisma.product.findUnique({ where: { id: sid, merchantId } })
      if (candidate && candidate.inventory > 0 && candidate.price > item.product.price) {
        candidatePool.push({ candidate, sourceProduct: item.product, isStatic: true })
      }
    }
  }

  for (const item of cartItems) {
    const dyn = await prisma.product.findMany({
      where: {
        merchantId,
        id: { notIn: Array.from(new Set([...cartProductIds, ...excludedProductIds])) },
        inventory: { gt: 0 },
        price: { gt: item.product.price, lte: Math.round(item.product.price * 2.2) },
        OR: [
          { category: { equals: item.product.category, mode: 'insensitive' } },
          ...(item.product.tags?.length ? [{ tags: { hasSome: item.product.tags } }] : []),
        ],
      },
      orderBy: { price: 'asc' },
      take: 6,
    }) || []
    for (const dynUpgrade of dyn) {
      if (!candidatePool.some(c => c.candidate.id === dynUpgrade.id)) {
        candidatePool.push({ candidate: dynUpgrade, sourceProduct: item.product, isStatic: false })
      }
    }
  }

  if (candidatePool.length === 0) return null

  const hasApiKey = Boolean(process.env.GROQ_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY)
  
  if (hasApiKey && candidatePool.length > 1) {
    try {
      const prompt = `You are an expert AI Merchandiser. Select the absolute best premium upsell (upgrade) product to recommend to a customer based on the item currently in their cart.

Customer Cart Base Item:
${cartItems.map(i => `- "${i.product.name}" (Category: ${i.product.category}, Price: ₹${i.product.price / 100})`).join('\n')}

Candidate Upgrade Products:
${candidatePool.map(c => `- ID: ${c.candidate.id} | Name: "${c.candidate.name}" | Category: ${c.candidate.category} | Price: ₹${c.candidate.price / 100} | Cost: ₹${c.candidate.cost / 100} | Inventory: ${c.candidate.inventory}`).join('\n')}

Select the candidate that represents the most logical and compelling premium upgrade step. Consider the price delta (ideally 15-60% more expensive) and gross margin. Return the selected ID and your reasoning.`

      const { object } = await executeWithFallback((model) => generateObject({
        model,
        schema: aiRecommendationSchema,
        prompt,
        temperature: 0.1,
      }))

      const selected = candidatePool.find(c => c.candidate.id === object.selectedCandidateId)
      if (selected) {
        const gm = selected.candidate.price > 0 ? Math.round(((selected.candidate.price - selected.candidate.cost) / selected.candidate.price) * 100) : 0
        return {
          product: selected.candidate,
          sourceProduct: selected.sourceProduct,
          reasoning: {
            categoryMatch: `Same-category premium tier (${selected.sourceProduct.category})`,
            inventoryDepth: `${selected.candidate.inventory} units available`,
            marginHealth: `${gm}% gross margin preserved`,
            compatibilityReason: object.reasoning.compatibilityReason,
            compositeScore: object.reasoning.synergyScore,
            synergyScore: object.reasoning.synergyScore,
            tradeOffAnalysis: object.reasoning.tradeOffAnalysis,
          }
        }
      }
    } catch (err) {
      console.warn('[AI_MERCHANDISER:LLM_FALLBACK] Using analytical baseline:', err)
    }
  }

  const scored = candidatePool.map(c => ({
    ...c,
    scores: calculateCandidateScore({ candidate: c.candidate, sourceProduct: c.sourceProduct, isStaticMatch: c.isStatic, isCrossSell: false })
  }))
  scored.sort((a, b) => b.scores.compositeScore - a.scores.compositeScore)
  const best = scored[0]

  return {
    product: best.candidate,
    sourceProduct: best.sourceProduct,
    reasoning: {
      categoryMatch: `Same-category premium tier (${best.sourceProduct.category})`,
      inventoryDepth: `${best.candidate.inventory} units available`,
      marginHealth: `${best.scores.grossMarginPercent}% gross margin preserved`,
      compatibilityReason: `Upgraded ${best.sourceProduct.name} ➔ ${best.candidate.name}.`,
      compositeScore: best.scores.compositeScore,
      synergyScore: best.scores.synergyScore,
      tradeOffAnalysis: `Premium tier upgrade with ${best.scores.grossMarginPercent}% margin.`,
    }
  }
}

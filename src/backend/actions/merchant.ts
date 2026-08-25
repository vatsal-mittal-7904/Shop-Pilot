'use server'

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/backend/db/prisma'
import { requireMerchant } from '@/backend/auth/session'

const productSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  price: z.number().int().positive().max(10_000_000),
  cost: z.number().int().nonnegative().max(10_000_000),
  inventory: z.number().int().nonnegative().max(100_000),
  warrantyYears: z.number().int().min(0).max(20),
  deliveryDays: z.number().int().min(0).max(60),
  imageUrl: z.string().url().max(2_000).optional().or(z.literal('')),
  tags: z.array(z.string().trim().min(1).max(40)).max(12),
  attributes: z.record(z.string(), z.string().max(200)).default({}),
})

type Opportunity = {
  id: 'abandoned-cart' | 'cross-sell' | 'clearance'
  title: string
  reason: string
  estimatedImpact: number
  type: 'RECOVERY' | 'BUNDLE' | 'CLEARANCE'
  configuration: Record<string, unknown>
  policy: { allowed: boolean; reason: string }
}

async function opportunitiesForMerchant(merchantId: string): Promise<Opportunity[]> {
  const [products, carts, policies] = await Promise.all([
    prisma.product.findMany({ where: { merchantId } }),
    prisma.cart.findMany({ where: { merchantId, status: 'ABANDONED', updatedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) } }, include: { items: true } }),
    prisma.merchantPolicy.findMany({ where: { merchantId } }),
  ])
  const policy = Object.fromEntries(policies.map((entry) => [entry.key, entry.value]))
  const maxBudget = policy.CAMPAIGN_BUDGET_LIMIT ?? 0
  const opportunities: Opportunity[] = []
  if (carts.length > 0) {
    let estimatedImpact = 0
    for (const cart of carts) {
      for (const item of cart.items) {
        const product = products.find((p) => p.id === item.productId)
        if (product) {
          estimatedImpact += product.price * item.quantity
        }
      }
    }
    
    opportunities.push({
      id: 'abandoned-cart', title: 'Abandoned-cart recovery', type: 'RECOVERY', estimatedImpact,
      reason: `${carts.length} cart${carts.length === 1 ? '' : 's'} have been inactive for over 30 minutes. Offer a policy-safe follow-up incentive.`,
      configuration: { cartIds: carts.map((cart) => cart.id), discountPercent: Math.min(10, policy.MAX_DISCOUNT_PERCENTAGE ?? 0) },
      policy: { allowed: estimatedImpact <= maxBudget, reason: estimatedImpact <= maxBudget ? 'Campaign estimate is within the merchant budget.' : 'Campaign estimate exceeds the merchant budget.' },
    })
  }
  const categoryMap = new Map()
  for (const product of products) {
    if (!categoryMap.has(product.category)) categoryMap.set(product.category, product)
  }
  const uniqueCategories = Array.from(categoryMap.values())
  if (uniqueCategories.length >= 2) {
    const bundleProducts = [uniqueCategories[0], uniqueCategories[1]]
    const discountPercent = Math.min(10, policy.MAX_DISCOUNT_PERCENTAGE ?? 0)
    const estimatedImpact = bundleProducts[0].price + bundleProducts[1].price
    opportunities.push({
      id: 'cross-sell', title: `${bundleProducts[0].category} + ${bundleProducts[1].category} bundle`, type: 'BUNDLE', estimatedImpact,
      reason: `The catalog contains ${bundleProducts[0].category} and ${bundleProducts[1].category} products. Present this as an optional bundle, never as a forced upsell.`,
      configuration: { productIds: [bundleProducts[0].id, bundleProducts[1].id], discountPercent },
      policy: { allowed: discountPercent <= (policy.MAX_DISCOUNT_PERCENTAGE ?? 0), reason: `Bundle discount is within the ${policy.MAX_DISCOUNT_PERCENTAGE ?? 0}% limit.` },
    })
  }
  const overstock = products.filter((product) => product.inventory >= 50)
  if (overstock.length) {
    const discountPercent = Math.min(8, policy.MAX_DISCOUNT_PERCENTAGE ?? 0)
    const estimatedImpact = overstock.reduce((sum, product) => sum + (product.price * product.inventory), 0)
    opportunities.push({
      id: 'clearance', title: 'Inventory-clearance campaign', type: 'CLEARANCE', estimatedImpact,
      reason: `${overstock.length} product${overstock.length === 1 ? '' : 's'} have high stock. Recommend an explainable, margin-safe clearance offer.`,
      configuration: { productIds: overstock.map((product) => product.id), discountPercent },
      policy: { allowed: discountPercent <= (policy.MAX_DISCOUNT_PERCENTAGE ?? 0), reason: `Clearance discount is within the ${policy.MAX_DISCOUNT_PERCENTAGE ?? 0}% limit.` },
    })
  }
  return opportunities
}

export async function getMerchantDashboardData() {
  const { merchant } = await requireMerchant()
  
  // Execute sequentially to avoid saturating the pg connection pool
  const orders = await prisma.order.findMany({ where: { merchantId: merchant.id }, include: { items: true }, orderBy: { createdAt: 'desc' }, take: 25 })
  const auditLogs = await prisma.auditLog.findMany({ where: { merchantId: merchant.id }, orderBy: { createdAt: 'desc' }, take: 50 })
  const products = await prisma.product.findMany({ where: { merchantId: merchant.id }, orderBy: { createdAt: 'desc' } })
  const campaigns = await prisma.campaign.findMany({ where: { merchantId: merchant.id }, orderBy: { createdAt: 'desc' }, take: 20 })
  const merchantPolicies = await prisma.merchantPolicy.findMany({ where: { merchantId: merchant.id } })
  const opportunities = await opportunitiesForMerchant(merchant.id)
  
  const totalOrdersCount = await prisma.order.count({ where: { merchantId: merchant.id } })
  const paidAgg = await prisma.order.aggregate({
    where: { merchantId: merchant.id, status: 'PAID' },
    _sum: { totalAmount: true },
    _count: true,
  })
  const policies = Object.fromEntries(merchantPolicies.map((entry) => [entry.key, entry.value])) as Record<string, number>
  return {
    overview: { 
      totalRevenue: paidAgg._sum.totalAmount || 0, 
      paidOrders: paidAgg._count, 
      totalOrders: totalOrdersCount, 
      aiRecoveredRevenue: merchant.aiRecoveredRevenue 
    },
    opportunities,
    products,
    orders,
    campaigns,
    policies,
    auditLogs,
  }
}

type ProductInput = z.infer<typeof productSchema>
export async function addProduct(input: ProductInput) {
  const { user, merchant } = await requireMerchant()
  const data = productSchema.parse(input)
  const product = await prisma.product.create({
    data: { merchantId: merchant.id, ...data, imageUrl: data.imageUrl || null },
  })
  await prisma.auditLog.create({ data: { merchantId: merchant.id, actorUserId: user.id, action: 'PRODUCT_ADDED', status: 'EXECUTED', reason: `Merchant added ${product.name}`, details: { productId: product.id } } })
  return product
}

export async function approveOpportunity(opportunityId: Opportunity['id']) {
  const { user, merchant } = await requireMerchant()
  const opportunity = (await opportunitiesForMerchant(merchant.id)).find((item) => item.id === opportunityId)
  if (!opportunity) throw new Error('This opportunity is no longer available')
  if (!opportunity.policy.allowed) throw new Error(opportunity.policy.reason)
  const campaign = await prisma.campaign.create({
    data: {
      merchantId: merchant.id, type: opportunity.type, title: opportunity.title, rationale: opportunity.reason,
      estimatedImpact: opportunity.estimatedImpact, discountPercent: Number(opportunity.configuration.discountPercent || 0),
      status: 'APPROVED', configuration: opportunity.configuration as Prisma.InputJsonValue,
    },
  })
  await prisma.$transaction([
    prisma.agentAction.create({ data: { merchantId: merchant.id, type: opportunity.type, reason: opportunity.reason, input: opportunity.configuration as Prisma.InputJsonValue, policyResult: opportunity.policy as Prisma.InputJsonValue, expectedImpact: opportunity.estimatedImpact, status: 'EXECUTED', campaignId: campaign.id } }),
    prisma.auditLog.create({ data: { merchantId: merchant.id, actorUserId: user.id, action: 'CAMPAIGN_APPROVED', status: 'EXECUTED', reason: opportunity.reason, details: { campaignId: campaign.id, opportunityId } } }),
  ])
  return campaign
}

async function merchantPolicyMap(merchantId: string) {
  const policies = await prisma.merchantPolicy.findMany({ where: { merchantId } })
  return Object.fromEntries(policies.map((entry) => [entry.key, entry.value])) as Record<string, number>
}

// Persists the current in-memory opportunities as PROPOSED campaigns so they can be
// reviewed (approved / rejected / modified) from the Campaigns list, rather than
// executed immediately the way approveOpportunity does.
export async function generateCampaigns() {
  const { user, merchant } = await requireMerchant()
  const opportunities = await opportunitiesForMerchant(merchant.id)

  const existingProposed = await prisma.campaign.findMany({
    where: { merchantId: merchant.id, status: 'PROPOSED' },
    select: { type: true },
  })
  const proposedTypes = new Set(existingProposed.map((entry) => entry.type))
  const toCreate = opportunities.filter((opportunity) => !proposedTypes.has(opportunity.type))

  if (toCreate.length === 0) return []

  const created = await prisma.$transaction(
    toCreate.map((opportunity) =>
      prisma.campaign.create({
        data: {
          merchantId: merchant.id,
          type: opportunity.type,
          title: opportunity.title,
          rationale: opportunity.reason,
          estimatedImpact: opportunity.estimatedImpact,
          discountPercent: Number(opportunity.configuration.discountPercent || 0),
          status: 'PROPOSED',
          configuration: opportunity.configuration as Prisma.InputJsonValue,
        },
      }),
    ),
  )

  await prisma.auditLog.create({
    data: {
      merchantId: merchant.id,
      actorUserId: user.id,
      action: 'CAMPAIGNS_GENERATED',
      status: 'EXECUTED',
      reason: `Generated ${created.length} campaign proposal${created.length === 1 ? '' : 's'}.`,
      details: { campaignIds: created.map((campaign) => campaign.id) },
    },
  })

  return created
}

export async function approveCampaign(campaignId: string) {
  const { user, merchant } = await requireMerchant()
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, merchantId: merchant.id } })
  if (!campaign) throw new Error('This campaign is no longer available')
  if (campaign.status !== 'PROPOSED') throw new Error('Only proposed campaigns can be approved')

  const policy = await merchantPolicyMap(merchant.id)
  const maxDiscount = policy.MAX_DISCOUNT_PERCENTAGE ?? 0
  if ((campaign.discountPercent ?? 0) > maxDiscount) {
    throw new Error(`Discount of ${campaign.discountPercent}% exceeds the ${maxDiscount}% merchant policy limit.`)
  }
  const maxBudget = policy.CAMPAIGN_BUDGET_LIMIT ?? 0
  if ((campaign.estimatedImpact ?? 0) > maxBudget) {
    throw new Error(`Campaign budget estimate of ${campaign.estimatedImpact} exceeds the ${maxBudget} merchant policy limit.`)
  }

  const [updated] = await prisma.$transaction([
    prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'APPROVED' } }),
    prisma.agentAction.create({
      data: {
        merchantId: merchant.id,
        type: campaign.type,
        reason: campaign.rationale,
        input: campaign.configuration as Prisma.InputJsonValue,
        policyResult: { allowed: true, reason: `Discount is within the ${maxDiscount}% limit.` } as Prisma.InputJsonValue,
        expectedImpact: campaign.estimatedImpact,
        status: 'EXECUTED',
        campaignId: campaign.id,
      },
    }),
    prisma.auditLog.create({
      data: { merchantId: merchant.id, actorUserId: user.id, action: 'CAMPAIGN_APPROVED', status: 'EXECUTED', reason: campaign.rationale, details: { campaignId: campaign.id } },
    }),
  ])
  return updated
}

export async function rejectCampaign(campaignId: string) {
  const { user, merchant } = await requireMerchant()
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, merchantId: merchant.id } })
  if (!campaign) throw new Error('This campaign is no longer available')
  if (campaign.status !== 'PROPOSED') throw new Error('Only proposed campaigns can be rejected')

  const [updated] = await prisma.$transaction([
    prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'REJECTED' } }),
    prisma.auditLog.create({
      data: { merchantId: merchant.id, actorUserId: user.id, action: 'CAMPAIGN_REJECTED', status: 'REJECTED', reason: campaign.rationale, details: { campaignId: campaign.id } },
    })
  ])
  return updated
}

const modifyCampaignSchema = z.object({
  discountPercent: z.number().min(0).max(100),
})

export async function modifyCampaign(campaignId: string, discountPercent: number) {
  const { user, merchant } = await requireMerchant()
  const { discountPercent: nextDiscount } = modifyCampaignSchema.parse({ discountPercent })

  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, merchantId: merchant.id } })
  if (!campaign) throw new Error('This campaign is no longer available')
  if (campaign.status !== 'PROPOSED') throw new Error('Only proposed campaigns can be modified')

  const policy = await merchantPolicyMap(merchant.id)
  const maxDiscount = policy.MAX_DISCOUNT_PERCENTAGE ?? 0
  if (nextDiscount > maxDiscount) {
    throw new Error(`Discount of ${nextDiscount}% exceeds the ${maxDiscount}% merchant policy limit.`)
  }

  const [updated] = await prisma.$transaction([
    prisma.campaign.update({ where: { id: campaign.id }, data: { discountPercent: nextDiscount } }),
    prisma.auditLog.create({
      data: {
        merchantId: merchant.id,
        actorUserId: user.id,
        action: 'CAMPAIGN_MODIFIED',
        status: 'EXECUTED',
        reason: `Discount updated to ${nextDiscount}%`,
        details: { campaignId: campaign.id, discountPercent: nextDiscount },
      },
    })
  ])
  return updated
}

// markAbandonedCarts (cartSweeper.ts) is deliberately not 'use server' and
// takes merchantId as a bare argument with no session check -- by its own
// doc comment it's for server-side callers only (the cron route). This
// wrapper is the sanctioned way to expose it to the client: it resolves
// merchantId from the authenticated session via requireMerchant() and never
// from a client-supplied argument, so a tampered request can't sweep another
// merchant's carts.
import { markAbandonedCarts } from '@/backend/actions/cartSweeper'
export async function runCartSweeper() {
  const { user, merchant } = await requireMerchant()
  const result = await markAbandonedCarts(merchant.id)

  await prisma.auditLog.create({
    data: {
      merchantId: merchant.id,
      actorUserId: user.id,
      action: 'CART_SWEEP_TRIGGERED',
      status: 'EXECUTED',
      reason: `Manually swept carts: ${result.updatedCount} marked abandoned (inactive past ${result.thresholdMinutes} minutes).`,
      details: { thresholdMinutes: result.thresholdMinutes, cutoff: result.cutoff.toISOString(), updatedCount: result.updatedCount },
    },
  })

  return result
}

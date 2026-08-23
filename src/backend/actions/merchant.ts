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
    prisma.cart.findMany({ where: { merchantId, status: 'ACTIVE', updatedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) } }, include: { items: true } }),
    prisma.merchantPolicy.findMany({ where: { merchantId } }),
  ])
  const policy = Object.fromEntries(policies.map((entry) => [entry.key, entry.value]))
  const maxBudget = policy.CAMPAIGN_BUDGET_LIMIT ?? 0
  const opportunities: Opportunity[] = []
  if (carts.length > 0) {
    const estimatedImpact = carts.length * 450000
    opportunities.push({
      id: 'abandoned-cart', title: 'Abandoned-cart recovery', type: 'RECOVERY', estimatedImpact,
      reason: `${carts.length} cart${carts.length === 1 ? '' : 's'} have been inactive for over 30 minutes. Offer a policy-safe follow-up incentive.`,
      configuration: { cartIds: carts.map((cart) => cart.id), discountPercent: Math.min(10, policy.MAX_DISCOUNT_PERCENTAGE ?? 0) },
      policy: { allowed: estimatedImpact <= maxBudget, reason: estimatedImpact <= maxBudget ? 'Campaign estimate is within the merchant budget.' : 'Campaign estimate exceeds the merchant budget.' },
    })
  }
  const keyboard = products.find((product) => product.category.toLowerCase().includes('keyboard'))
  const mouse = products.find((product) => product.category.toLowerCase().includes('mouse'))
  if (keyboard && mouse) {
    const discountPercent = Math.min(10, policy.MAX_DISCOUNT_PERCENTAGE ?? 0)
    opportunities.push({
      id: 'cross-sell', title: 'Keyboard + mouse bundle', type: 'BUNDLE', estimatedImpact: 1720000,
      reason: 'The catalog contains complementary keyboard and mouse products. Present this as an optional bundle, never as a forced upsell.',
      configuration: { productIds: [keyboard.id, mouse.id], discountPercent },
      policy: { allowed: discountPercent <= (policy.MAX_DISCOUNT_PERCENTAGE ?? 0), reason: `Bundle discount is within the ${policy.MAX_DISCOUNT_PERCENTAGE ?? 0}% limit.` },
    })
  }
  const overstock = products.filter((product) => product.inventory >= 50)
  if (overstock.length) {
    const discountPercent = Math.min(8, policy.MAX_DISCOUNT_PERCENTAGE ?? 0)
    opportunities.push({
      id: 'clearance', title: 'Inventory-clearance campaign', type: 'CLEARANCE', estimatedImpact: overstock.length * 250000,
      reason: `${overstock.length} product${overstock.length === 1 ? '' : 's'} have high stock. Recommend an explainable, margin-safe clearance offer.`,
      configuration: { productIds: overstock.map((product) => product.id), discountPercent },
      policy: { allowed: discountPercent <= (policy.MAX_DISCOUNT_PERCENTAGE ?? 0), reason: `Clearance discount is within the ${policy.MAX_DISCOUNT_PERCENTAGE ?? 0}% limit.` },
    })
  }
  return opportunities
}

export async function getMerchantDashboardData() {
  const { merchant } = await requireMerchant()
  const [orders, auditLogs, products, campaigns, opportunities] = await Promise.all([
    prisma.order.findMany({ where: { merchantId: merchant.id }, include: { items: true }, orderBy: { createdAt: 'desc' }, take: 25 }),
    prisma.auditLog.findMany({ where: { merchantId: merchant.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.product.findMany({ where: { merchantId: merchant.id }, orderBy: { createdAt: 'desc' } }),
    prisma.campaign.findMany({ where: { merchantId: merchant.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    opportunitiesForMerchant(merchant.id),
  ])
  const paidOrders = orders.filter((order) => order.status === 'PAID')
  return {
    overview: { totalRevenue: paidOrders.reduce((sum, order) => sum + order.totalAmount, 0), paidOrders: paidOrders.length, totalOrders: orders.length, aiRecoveredRevenue: merchant.aiRecoveredRevenue },
    opportunities,
    products,
    orders,
    campaigns,
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

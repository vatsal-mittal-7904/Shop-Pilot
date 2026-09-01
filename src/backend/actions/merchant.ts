'use server'

import { requireMerchant } from '@/backend/auth/session'

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/backend/db/prisma'
import { productRelationshipListSchema } from '@/backend/validators/productRelationship'
import { getRecoveryAttribution } from '@/backend/actions/recoveryAttribution'

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
  relatedProducts: productRelationshipListSchema.default([]),
  complementaryProducts: productRelationshipListSchema.default([]),
  upgradeProducts: productRelationshipListSchema.default([]),
})

type Opportunity = {
  id: 'abandoned-cart' | 'cross-sell' | 'clearance'
  title: string
  reason: string
  estimatedImpact: number
  budget: number
  type: 'RECOVERY' | 'BUNDLE' | 'CLEARANCE'
  configuration: Record<string, unknown>
  policy: { allowed: boolean; reason: string }
}

async function opportunitiesForMerchant(merchantId: string): Promise<Opportunity[]> {
  const [carts, policies] = await Promise.all([
    // markAbandonedCarts already applies the inactivity policy before changing
    // this status. Do not filter updatedAt again: Prisma updates that timestamp
    // when the sweeper writes ABANDONED, which previously hid newly swept carts
    // from the campaign generator for another 30 minutes.
    prisma.cart.findMany({ where: { merchantId, status: 'ABANDONED' }, include: { items: { include: { product: true } } } }),
    prisma.merchantPolicy.findMany({ where: { merchantId } }),
  ])
  const policy = Object.fromEntries(policies.map((entry) => [entry.key, entry.value]))
  const maxBudget = policy.CAMPAIGN_BUDGET_LIMIT ?? 0
  const opportunities: Opportunity[] = []
  if (carts.length > 0) {
    let estimatedImpact = 0
    for (const cart of carts) {
      for (const item of cart.items) {
        estimatedImpact += item.product.price * item.quantity
      }
    }

    const discountPercent = Math.min(10, policy.MAX_DISCOUNT_PERCENTAGE ?? 0)
    const budget = Math.floor(estimatedImpact * (discountPercent / 100))
    opportunities.push({
      id: 'abandoned-cart', title: 'Abandoned-cart recovery', type: 'RECOVERY', estimatedImpact,
      reason: `${carts.length} cart${carts.length === 1 ? '' : 's'} have been inactive for over 30 minutes. Offer a policy-safe follow-up incentive.`,
      budget,
      configuration: { cartIds: carts.map((cart) => cart.id), discountPercent },
      policy: { allowed: budget <= maxBudget, reason: budget <= maxBudget ? 'Campaign discount budget is within the merchant limit.' : 'Campaign discount budget exceeds the merchant limit.' },
    })
  }

  // Clearance has a concrete recipient and delivery path: choose one
  // high-inventory SKU, then target existing customers who bought from this
  // merchant but have not purchased that SKU. The resulting offers appear in
  // their authenticated storefront; this is not a dashboard-only campaign.
  const clearanceThreshold = Math.max(1, policy.CLEARANCE_INVENTORY_THRESHOLD ?? 20)
  const clearanceCandidates = await prisma.product.findMany({
    where: { merchantId, inventory: { gte: clearanceThreshold } },
    orderBy: [{ inventory: 'desc' }, { createdAt: 'asc' }],
    take: 5,
  })
  for (const product of clearanceCandidates) {
    const recipients = await prisma.customer.findMany({
      where: {
        orders: {
          some: { merchantId, status: 'PAID' },
          none: { merchantId, items: { some: { productId: product.id } } },
        },
      },
      select: { id: true },
      take: 100,
    })
    if (recipients.length === 0) continue
    const discountPercent = Math.min(10, policy.MAX_DISCOUNT_PERCENTAGE ?? 0)
    const estimatedImpact = product.price * recipients.length
    const budget = Math.floor(estimatedImpact * (discountPercent / 100))
    opportunities.push({
      id: 'clearance',
      title: `Clearance: ${product.name}`,
      type: 'CLEARANCE',
      estimatedImpact,
      budget,
      reason: `${product.inventory} units are available. Target ${recipients.length} prior customer${recipients.length === 1 ? '' : 's'} who have not purchased this SKU.`,
      configuration: { productId: product.id, customerIds: recipients.map((recipient) => recipient.id), discountPercent },
      policy: { allowed: budget <= maxBudget, reason: budget <= maxBudget ? 'Campaign discount budget is within the merchant limit.' : 'Campaign discount budget exceeds the merchant limit.' },
    })
    break
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
  const reconciliationQueue = await prisma.refund.findMany({
    where: { order: { merchantId: merchant.id }, status: { not: 'REFUNDED' } },
    include: { order: { select: { razorpayOrderId: true } } },
    orderBy: { nextAttemptAt: 'asc' },
    take: 20,
  })
  const paymentReconciliationQueue = await prisma.paymentReconciliation.findMany({
    where: { order: { merchantId: merchant.id }, status: { not: 'RESOLVED' } },
    include: { order: { select: { razorpayOrderId: true, status: true } } },
    orderBy: { nextAttemptAt: 'asc' },
    take: 20,
  })

  const totalOrdersCount = await prisma.order.count({ where: { merchantId: merchant.id } })
  const paidOrders = await prisma.order.findMany({
    where: { merchantId: merchant.id, status: 'PAID' },
    select: { totalAmount: true },
  })
  const recoveryAttribution = await getRecoveryAttribution(merchant.id)
  const policies = Object.fromEntries(merchantPolicies.map((entry) => [entry.key, entry.value])) as Record<string, number>
  return {
    overview: {
      totalRevenue: paidOrders.reduce((sum, order) => sum + order.totalAmount, 0),
      paidOrders: paidOrders.length,
      totalOrders: totalOrdersCount,
      aiRecoveredRevenue: recoveryAttribution.revenue
    },
    opportunities,
    products,
    orders,
    campaigns,
    policies,
    auditLogs,
    reconciliationQueue,
    paymentReconciliationQueue,
  }
}

type ProductInput = z.infer<typeof productSchema>
export async function updateProduct(productId: string, input: ProductInput) {
  const { user, merchant } = await requireMerchant()
  const data = productSchema.parse(input)

  const allRelatedIds = [...new Set([...(data.relatedProducts || []), ...(data.complementaryProducts || []), ...(data.upgradeProducts || [])])];

  if (allRelatedIds.includes(productId)) {
    throw new Error('Product cannot be related to itself');
  }

  if (allRelatedIds.length > 0) {
    const validProducts = await prisma.product.findMany({
      where: { id: { in: allRelatedIds }, merchantId: merchant.id, inventory: { gt: 0 } },
      select: { id: true }
    });
    const validIds = new Set(validProducts.map(p => p.id));
    for (const id of allRelatedIds) {
      if (!validIds.has(id)) {
        throw new Error(`Invalid or unavailable related product ID: ${id}`);
      }
    }
  }

  const product = await prisma.product.update({
    where: { id: productId, merchantId: merchant.id },
    data: { ...data, imageUrl: data.imageUrl || null },
  })
  await prisma.auditLog.create({ data: { merchantId: merchant.id, actorUserId: user.id, action: 'PRODUCT_UPDATED', status: 'EXECUTED', reason: `Merchant updated ${product.name}`, details: { productId: product.id } } })
  return product
}

export async function deleteProduct(productId: string) {
  const { user, merchant } = await requireMerchant()
  const product = await prisma.product.delete({
    where: { id: productId, merchantId: merchant.id },
  })
  await prisma.auditLog.create({ data: { merchantId: merchant.id, actorUserId: user.id, action: 'PRODUCT_DELETED', status: 'EXECUTED', reason: `Merchant deleted ${product.name}`, details: { productId: product.id } } })
  return product
}

export async function addProduct(input: ProductInput) {
  const { user, merchant } = await requireMerchant()
  const data = productSchema.parse(input)

  const allRelatedIds = [...new Set([...(data.relatedProducts || []), ...(data.complementaryProducts || []), ...(data.upgradeProducts || [])])];

  if (allRelatedIds.length > 0) {
    const validProducts = await prisma.product.findMany({
      where: { id: { in: allRelatedIds }, merchantId: merchant.id, inventory: { gt: 0 } },
      select: { id: true }
    });
    const validIds = new Set(validProducts.map(p => p.id));
    for (const id of allRelatedIds) {
      if (!validIds.has(id)) {
        throw new Error(`Invalid or unavailable related product ID: ${id}`);
      }
    }
  }

  const product = await prisma.product.create({
    data: { merchantId: merchant.id, ...data, imageUrl: data.imageUrl || null },
  })
  await prisma.auditLog.create({ data: { merchantId: merchant.id, actorUserId: user.id, action: 'PRODUCT_ADDED', status: 'EXECUTED', reason: `Merchant added ${product.name}`, details: { productId: product.id } } })
  return product
}

export async function approveOpportunity(opportunityId: Opportunity['id']) {
  const { merchant } = await requireMerchant()
  const opportunity = (await opportunitiesForMerchant(merchant.id)).find((item) => item.id === opportunityId)
  if (!opportunity) throw new Error('This opportunity is no longer available')
  if (!opportunity.policy.allowed) throw new Error(opportunity.policy.reason)
  const campaign = await prisma.campaign.create({
    data: {
      merchantId: merchant.id, type: opportunity.type, title: opportunity.title, rationale: opportunity.reason,
      estimatedImpact: opportunity.estimatedImpact, budget: opportunity.budget, discountPercent: Number(opportunity.configuration.discountPercent || 0),
      status: 'PROPOSED', configuration: opportunity.configuration as Prisma.InputJsonValue,
    },
  })
  // Use the same approval path as persisted proposals so every campaign is
  // revalidated immediately before execution and gets the same audit trail.
  return approveCampaign(campaign.id)
}

async function merchantPolicyMap(merchantId: string) {
  const policies = await prisma.merchantPolicy.findMany({ where: { merchantId } })
  return Object.fromEntries(policies.map((entry) => [entry.key, entry.value])) as Record<string, number>
}

const recoveryCampaignConfigSchema = z.object({
  cartIds: z.array(z.string().uuid()).min(1).max(100),
  discountPercent: z.number().finite().min(0).max(100),
})

const clearanceCampaignConfigSchema = z.object({
  productId: z.string().uuid(),
  customerIds: z.array(z.string().uuid()).min(1).max(100),
  discountPercent: z.number().finite().min(0).max(100),
})


// Persists the current in-memory opportunities as PROPOSED campaigns so they can be
// reviewed (approved / rejected / modified) from the Campaigns list, rather than
// executed immediately the way approveOpportunity does.
export async function generateCampaigns() {
  const { user, merchant } = await requireMerchant()
  const opportunities = await opportunitiesForMerchant(merchant.id)

  const existingActive = await prisma.campaign.findMany({
    where: { merchantId: merchant.id, status: { in: ['PROPOSED', 'APPROVED'] } },
    select: { type: true },
  })
  const activeTypes = new Set(existingActive.map((entry) => entry.type))
  const toCreate = opportunities.filter((opportunity) => !activeTypes.has(opportunity.type))

  if (toCreate.length === 0) return []

  const created = await prisma.$transaction(async (tx) => {
    const campaigns = await Promise.all(
      toCreate.map((opportunity) =>
        tx.campaign.create({
          data: {
            merchantId: merchant.id,
            type: opportunity.type,
            title: opportunity.title,
            rationale: opportunity.reason,
            estimatedImpact: opportunity.estimatedImpact,
            budget: opportunity.budget,
            discountPercent: Number(opportunity.configuration.discountPercent || 0),
            status: 'PROPOSED',
            configuration: opportunity.configuration as Prisma.InputJsonValue,
          },
        })
      )
    );

    await tx.auditLog.create({
      data: {
        merchantId: merchant.id,
        actorUserId: user.id,
        action: 'CAMPAIGNS_GENERATED',
        status: 'EXECUTED',
        reason: `Generated ${campaigns.length} campaign proposal${campaigns.length === 1 ? '' : 's'}.`,
        details: { campaignIds: campaigns.map((campaign) => campaign.id) },
      },
    });

    return campaigns;
  });

  return created
}

export async function approveCampaign(campaignId: string) {
  const { user, merchant } = await requireMerchant()

  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findFirst({
      where: { id: campaignId, merchantId: merchant.id }
    })
    if (!campaign) throw new Error('This campaign is no longer available')
    if (campaign.status !== 'PROPOSED') throw new Error('Only proposed campaigns can be approved')
    if (campaign.type !== 'RECOVERY' && campaign.type !== 'CLEARANCE') {
      throw new Error('This campaign has no deterministic recipient delivery path and may not be approved.')
    }

    const policies = Object.fromEntries(
      (await tx.merchantPolicy.findMany({ where: { merchantId: merchant.id } })).map((policy) => [policy.key, policy.value])
    ) as Record<string, number>

    const maxDiscount = policies.MAX_DISCOUNT_PERCENTAGE ?? 0
    if ((campaign.discountPercent ?? 0) > maxDiscount) {
      throw new Error(`Discount of ${campaign.discountPercent}% exceeds the ${maxDiscount}% merchant policy limit.`)
    }
    const maxBudget = policies.CAMPAIGN_BUDGET_LIMIT ?? 0
    if ((campaign.budget ?? 0) > maxBudget) {
      throw new Error(`Campaign budget of ${campaign.budget ?? 0} exceeds the ${maxBudget} merchant policy limit.`)
    }

    if (campaign.type === 'CLEARANCE') {
      return dispatchClearanceCampaign({ tx, campaign, merchantId: merchant.id, actorUserId: user.id, policies })
    }

    const config = recoveryCampaignConfigSchema.parse(campaign.configuration)
    const discountPercent = campaign.discountPercent ?? config.discountPercent

    const carts = await tx.cart.findMany({
      where: { id: { in: config.cartIds }, merchantId: merchant.id, status: 'ABANDONED' },
      include: { items: { include: { product: true } } },
    })

    const campaignBudget = campaign.budget ?? 0
    let issuedDiscount = 0
    const issuedOfferIds: string[] = []
    const skippedCartIds: string[] = []

    for (const cart of carts) {
      if (cart.items.length === 0 || cart.items.some((item) => item.product.inventory < item.quantity)) {
        skippedCartIds.push(cart.id)
        continue
      }

      const subtotal = cart.items.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
      const discount = Math.floor(subtotal * (discountPercent / 100))
      const total = subtotal - discount
      const cost = cart.items.reduce((sum, item) => sum + item.product.cost * item.quantity, 0)
      const marginPercent = total > 0 ? ((total - cost) / total) * 100 : -Infinity

      if (
        issuedDiscount + discount > campaignBudget ||
        marginPercent < (policies.MIN_MARGIN_PERCENTAGE ?? 0)
      ) {
        skippedCartIds.push(cart.id)
        continue
      }

      const offer = await tx.offer.create({
        data: {
          merchantId: merchant.id,
          customerId: cart.customerId,
          cartId: cart.id,
          campaignId: campaign.id,
          subtotal,
          discount,
          total,
          discountPercent,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          items: {
            create: cart.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.product.price - Math.floor(item.product.price * (discountPercent / 100)),
            })),
          },
        },
        select: { id: true },
      })
      issuedDiscount += discount
      issuedOfferIds.push(offer.id)
    }

    const completedCampaign = await tx.campaign.update({
      where: { id: campaign.id },
      data: { status: 'COMPLETED' },
    })

    await tx.agentAction.create({
      data: {
        merchantId: merchant.id,
        type: campaign.type,
        reason: campaign.rationale,
        input: campaign.configuration as Prisma.InputJsonValue,
        policyResult: { allowed: true, reason: `Discount is within the ${maxDiscount}% limit.`, budget: campaign.budget ?? 0 } as Prisma.InputJsonValue,
        expectedImpact: campaign.estimatedImpact,
        status: 'APPROVED',
        campaignId: campaign.id,
      },
    })
    
    await tx.auditLog.create({
      data: { merchantId: merchant.id, actorUserId: user.id, action: 'CAMPAIGN_APPROVED', status: 'APPROVED', reason: campaign.rationale, details: { campaignId: campaign.id, campaignType: campaign.type } },
    })

    await tx.agentAction.create({
      data: {
        merchantId: merchant.id,
        campaignId: campaign.id,
        type: 'RECOVERY_CAMPAIGN_DISPATCH',
        reason: 'Issued bounded abandoned-cart recovery offers from an approved campaign.',
        input: { cartIds: config.cartIds, discountPercent } as Prisma.InputJsonValue,
        policyResult: {
          allowed: true,
          maxDiscount,
          minMargin: policies.MIN_MARGIN_PERCENTAGE ?? 0,
          campaignBudget,
          issuedDiscount,
        } as Prisma.InputJsonValue,
        expectedImpact: campaign.estimatedImpact,
        status: 'EXECUTED',
      },
    })
    
    await tx.auditLog.create({
      data: {
        merchantId: merchant.id,
        actorUserId: user.id,
        action: 'RECOVERY_CAMPAIGN_DISPATCHED',
        status: 'EXECUTED',
        reason: 'Campaign issued customer-specific recovery offers after current policy, margin, inventory, and budget validation.',
        details: { campaignId: campaign.id, issuedOfferIds, skippedCartIds, issuedDiscount, campaignBudget },
      },
    })

    return completedCampaign
  }, { isolationLevel: 'Serializable' })}

/** Dispatches one approved clearance SKU to a precomputed, eligible customer set. */
async function dispatchClearanceCampaign({
  tx,
  campaign,
  merchantId,
  actorUserId,
  policies,
}: {
  tx: Prisma.TransactionClient
  campaign: { id: string; rationale: string; configuration: Prisma.JsonValue; budget: number | null; discountPercent: number | null; estimatedImpact: number }
  merchantId: string
  actorUserId: string
  policies: Record<string, number>
}) {
  const config = clearanceCampaignConfigSchema.parse(campaign.configuration)
  const discountPercent = campaign.discountPercent ?? config.discountPercent
  const product = await tx.product.findFirst({
    where: { id: config.productId, merchantId, inventory: { gt: 0 } },
  })
  if (!product) throw new Error('Clearance product is no longer available.')

  const unitDiscount = Math.floor(product.price * (discountPercent / 100))
  const unitPrice = product.price - unitDiscount
  const marginPercent = unitPrice > 0 ? ((unitPrice - product.cost) / unitPrice) * 100 : -Infinity
  if (marginPercent < (policies.MIN_MARGIN_PERCENTAGE ?? 0)) {
    throw new Error('Clearance campaign would violate the minimum merchant margin.')
  }

  const eligibleRecipients = await tx.customer.findMany({
    where: {
      id: { in: config.customerIds },
      orders: {
        some: { merchantId, status: 'PAID' },
        none: { merchantId, items: { some: { productId: product.id } } },
      },
    },
    select: { id: true },
  })
  if (eligibleRecipients.length === 0) {
    throw new Error('No eligible clearance recipients remain.')
  }

  const campaignBudget = campaign.budget ?? 0
  const recipientLimit = Math.min(eligibleRecipients.length, Math.floor(campaignBudget / unitDiscount))
  if (recipientLimit < 1) throw new Error('Campaign budget cannot fund a clearance offer.')

  const issuedOfferIds: string[] = []
  for (const recipient of eligibleRecipients.slice(0, recipientLimit)) {
    const offer = await tx.offer.create({
      data: {
        merchantId,
        customerId: recipient.id,
        campaignId: campaign.id,
        subtotal: product.price,
        discount: unitDiscount,
        total: unitPrice,
        discountPercent,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        items: { create: { productId: product.id, quantity: 1, unitPrice } },
      },
      select: { id: true },
    })
    issuedOfferIds.push(offer.id)
  }

  const issuedDiscount = unitDiscount * issuedOfferIds.length
  const completedCampaign = await tx.campaign.update({
    where: { id: campaign.id },
    data: { status: 'COMPLETED' },
  })
  await tx.agentAction.create({
    data: {
      merchantId,
      campaignId: campaign.id,
      type: 'CLEARANCE',
      reason: campaign.rationale,
      input: campaign.configuration as Prisma.InputJsonValue,
      policyResult: {
        allowed: true,
        maxDiscount: policies.MAX_DISCOUNT_PERCENTAGE ?? 0,
        minMargin: policies.MIN_MARGIN_PERCENTAGE ?? 0,
        campaignBudget,
        issuedDiscount,
        recipientCount: issuedOfferIds.length,
      } as Prisma.InputJsonValue,
      expectedImpact: campaign.estimatedImpact,
      status: 'APPROVED',
    },
  })
  await tx.agentAction.create({
    data: {
      merchantId,
      campaignId: campaign.id,
      type: 'CLEARANCE_CAMPAIGN_DISPATCH',
      reason: 'Issued bounded clearance offers to eligible prior customers.',
      input: { productId: product.id, customerIds: eligibleRecipients.slice(0, recipientLimit).map((recipient) => recipient.id), discountPercent } as Prisma.InputJsonValue,
      policyResult: { allowed: true, campaignBudget, issuedDiscount, marginPercent } as Prisma.InputJsonValue,
      expectedImpact: campaign.estimatedImpact,
      status: 'EXECUTED',
    },
  })
  await tx.auditLog.create({
    data: {
      merchantId,
      actorUserId,
      action: 'CLEARANCE_CAMPAIGN_DISPATCHED',
      status: 'EXECUTED',
      reason: 'Merchant-approved clearance campaign issued bounded offers to eligible recipients.',
      details: { campaignId: campaign.id, productId: product.id, issuedOfferIds, issuedDiscount, campaignBudget, marginPercent },
    },
  })
  return completedCampaign
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

  const nextBudget = Math.floor(campaign.estimatedImpact * (nextDiscount / 100))
  if (nextBudget > (policy.CAMPAIGN_BUDGET_LIMIT ?? 0)) {
    throw new Error(`Campaign budget of ${nextBudget} exceeds the ${policy.CAMPAIGN_BUDGET_LIMIT ?? 0} merchant policy limit.`)
  }
  const currentConfiguration = campaign.configuration as Record<string, unknown>
  const [updated] = await prisma.$transaction([
    prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        discountPercent: nextDiscount,
        budget: nextBudget,
        configuration: { ...currentConfiguration, discountPercent: nextDiscount } as Prisma.InputJsonValue,
      },
    }),
    prisma.auditLog.create({
      data: {
        merchantId: merchant.id,
        actorUserId: user.id,
        action: 'CAMPAIGN_MODIFIED',
        status: 'EXECUTED',
        reason: `Discount updated to ${nextDiscount}%`,
        details: { campaignId: campaign.id, discountPercent: nextDiscount, budget: nextBudget },
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

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

import { Opportunity } from '@/backend/actions/campaignProposalEngine'
import { generateModelDerivedCampaignProposals } from '@/backend/ai/campaignStrategyAgent'
import { triggerOpportunisticReconciliation } from '@/backend/actions/opportunisticReconciliation'

async function opportunitiesForMerchant(merchantId: string): Promise<Opportunity[]> {
  try {
    return await generateModelDerivedCampaignProposals(merchantId)
  } catch (err) {
    console.warn('[MERCHANT_DASHBOARD:OPPORTUNITIES_ERROR] Failed to generate campaign proposals, degrading gracefully:', err)
    return []
  }
}

export async function getMerchantDashboardData() {
  const { merchant } = await requireMerchant()

  // Tier 2 Self-Healing: Opportunistically heal due reconciliation tasks and refunds on dashboard access
  await triggerOpportunisticReconciliation({
    merchantId: merchant.id,
    maxReconciliations: 5,
    maxRefunds: 5,
    sweepCarts: false,
  }).catch((err) => {
    console.error('[DASHBOARD_RECONCILIATION:NON_BLOCKING_ERROR]', err)
  })

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

export async function addBundleOption(primaryProductId: string, addonProductId: string) {
  const { user, merchant } = await requireMerchant()

  if (!primaryProductId || !addonProductId) {
    throw new Error('Both primary product and addon product are required')
  }

  if (primaryProductId === addonProductId) {
    throw new Error('A product cannot be bundled with itself')
  }

  const [primaryProduct, addonProduct] = await Promise.all([
    prisma.product.findUnique({ where: { id: primaryProductId, merchantId: merchant.id } }),
    prisma.product.findUnique({ where: { id: addonProductId, merchantId: merchant.id } }),
  ])

  if (!primaryProduct) {
    throw new Error('Primary product not found or unauthorized')
  }
  if (!addonProduct) {
    throw new Error('Addon product not found or unauthorized')
  }
  if (addonProduct.inventory <= 0) {
    throw new Error('Cannot bundle an out-of-stock product')
  }

  if (primaryProduct.upgradeProducts?.includes(addonProductId)) {
    throw new Error('Upgrade products cannot be bundled as cross-sell add-ons')
  }

  const existingComplementary = primaryProduct.complementaryProducts || []
  if (existingComplementary.includes(addonProductId)) {
    return primaryProduct
  }

  const updated = await prisma.product.update({
    where: { id: primaryProductId, merchantId: merchant.id },
    data: {
      complementaryProducts: [...existingComplementary, addonProductId],
    },
  })

  await prisma.auditLog.create({
    data: {
      merchantId: merchant.id,
      actorUserId: user.id,
      action: 'BUNDLE_OPTION_CREATED',
      status: 'EXECUTED',
      reason: `Merchant paired ${addonProduct.name} as a bundle add-on for ${primaryProduct.name}`,
      details: {
        primaryProductId,
        addonProductId,
        primaryName: primaryProduct.name,
        addonName: addonProduct.name,
      },
    },
  })

  return updated
}

export async function removeBundleOption(primaryProductId: string, addonProductId: string) {
  const { user, merchant } = await requireMerchant()

  const primaryProduct = await prisma.product.findUnique({
    where: { id: primaryProductId, merchantId: merchant.id },
  })
  if (!primaryProduct) {
    throw new Error('Primary product not found or unauthorized')
  }

  const existingComplementary = primaryProduct.complementaryProducts || []
  const filtered = existingComplementary.filter((id) => id !== addonProductId)

  const updated = await prisma.product.update({
    where: { id: primaryProductId, merchantId: merchant.id },
    data: {
      complementaryProducts: filtered,
    },
  })

  await prisma.auditLog.create({
    data: {
      merchantId: merchant.id,
      actorUserId: user.id,
      action: 'BUNDLE_OPTION_REMOVED',
      status: 'EXECUTED',
      reason: `Merchant removed bundle option ${addonProductId} from ${primaryProduct.name}`,
      details: { primaryProductId, addonProductId },
    },
  })

  return updated
}

export async function applyMerchantBundlePresets() {
  const { user, merchant } = await requireMerchant()

  const presetCatalog = [
    {
      name: 'Ergonomic Memory Foam Wrist Rest', category: 'accessories', price: 149900, cost: 59900, inventory: 40,
      warrantyYears: 1, deliveryDays: 2, tags: ['keyboard', 'ergonomic', 'accessories', 'bundle', 'addon'],
      attributes: { material: 'Cooling memory foam', base: 'Non-slip rubber', width: 'Full size (44cm)' },
      imageUrl: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=80',
    },
    {
      name: 'Custom Coiled Aviator Cable', category: 'accessories', price: 129900, cost: 49900, inventory: 35,
      warrantyYears: 1, deliveryDays: 2, tags: ['keyboard', 'cables', 'accessories', 'bundle', 'addon'],
      attributes: { connector: 'GX16 Aviator + USB-C', length: '1.5m', shielding: 'Double braided PET' },
      imageUrl: 'https://images.unsplash.com/photo-1618384887929-16ec33fab9ef?auto=format&fit=crop&w=900&q=80',
    },
    {
      name: 'Extended Non-Slip Desk Mat XXL', category: 'accessories', price: 119900, cost: 44900, inventory: 50,
      warrantyYears: 1, deliveryDays: 2, tags: ['desk mats', 'accessories', 'mouse', 'keyboard', 'bundle', 'addon'],
      attributes: { dimensions: '900x400x4mm', surface: 'Micro-weave cloth', edge: 'Anti-fray stitched' },
      imageUrl: 'https://images.unsplash.com/photo-1616440347437-b1c73416efc2?auto=format&fit=crop&w=900&q=80',
    },
    {
      name: 'Aluminum Headphone Stand', category: 'accessories', price: 169900, cost: 69900, inventory: 30,
      warrantyYears: 2, deliveryDays: 2, tags: ['headphones', 'stands', 'accessories', 'audio', 'bundle', 'addon'],
      attributes: { material: 'Aerospace aluminum', cradle: 'Curved TPU silicone', base: 'Weighted non-slip' },
      imageUrl: 'https://images.unsplash.com/photo-1584679109597-c656b19974c9?auto=format&fit=crop&w=900&q=80',
    },
    {
      name: 'Velour Cooling Ear Cushions', category: 'accessories', price: 89900, cost: 34900, inventory: 25,
      warrantyYears: 1, deliveryDays: 2, tags: ['headphones', 'accessories', 'audio', 'bundle', 'addon'],
      attributes: { fabric: 'Breathable velour + cooling gel', fit: 'Universal oval 100mm' },
      imageUrl: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=900&q=80',
    },
    {
      name: 'Braided 100W USB-C PD Cable', category: 'accessories', price: 69900, cost: 24900, inventory: 60,
      warrantyYears: 2, deliveryDays: 2, tags: ['cables', 'accessories', 'mouse', 'chargers', 'bundle', 'addon'],
      attributes: { wattage: '100W Power Delivery', length: '2m' },
      imageUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=900&q=80',
    },
    {
      name: 'Aluminum Ventilated Laptop Riser Stand', category: 'accessories', price: 219900, cost: 89900, inventory: 30,
      warrantyYears: 2, deliveryDays: 2, tags: ['laptops', 'workstation', 'accessories', 'bundle', 'addon'],
      attributes: { angle: '6-level adjustable ergonomic tilt', material: 'Sandblasted aluminum' },
      imageUrl: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=900&q=80',
    },
  ]

  for (const item of presetCatalog) {
    const existing = await prisma.product.findFirst({
      where: { merchantId: merchant.id, name: item.name },
    })
    if (!existing) {
      await prisma.product.create({
        data: { merchantId: merchant.id, ...item },
      })
    }
  }

  const allProducts = await prisma.product.findMany({
    where: { merchantId: merchant.id },
  })
  const byName = (n: string) => allProducts.find((p) => p.name === n)

  const kb = byName('Wireless Mechanical Keyboard')
  const proKb = byName('Pro Wireless Mechanical Keyboard')
  const mouse = byName('Ergonomic Wireless Mouse')
  const headphones = byName('Noise Cancelling Headphones')
  const hub = byName('Premium USB-C Docking Hub')
  const wristRest = byName('Ergonomic Memory Foam Wrist Rest')
  const aviatorCable = byName('Custom Coiled Aviator Cable')
  const deskMat = byName('Extended Non-Slip Desk Mat XXL')
  const headphoneStand = byName('Aluminum Headphone Stand')
  const earCushions = byName('Velour Cooling Ear Cushions')
  const usbCable = byName('Braided 100W USB-C PD Cable')
  const laptopStand = byName('Aluminum Ventilated Laptop Riser Stand')

  const updates: Array<{ id: string; complementary: string[] }> = []

  if (kb) {
    const addons = [wristRest?.id, deskMat?.id, aviatorCable?.id, mouse?.id].filter(Boolean) as string[]
    updates.push({ id: kb.id, complementary: Array.from(new Set([...kb.complementaryProducts, ...addons])) })
  }
  if (proKb) {
    const addons = [wristRest?.id, aviatorCable?.id, deskMat?.id].filter(Boolean) as string[]
    updates.push({ id: proKb.id, complementary: Array.from(new Set([...proKb.complementaryProducts, ...addons])) })
  }
  if (mouse) {
    const addons = [deskMat?.id, usbCable?.id].filter(Boolean) as string[]
    updates.push({ id: mouse.id, complementary: Array.from(new Set([...mouse.complementaryProducts, ...addons])) })
  }
  if (headphones) {
    const addons = [headphoneStand?.id, earCushions?.id].filter(Boolean) as string[]
    updates.push({ id: headphones.id, complementary: Array.from(new Set([...headphones.complementaryProducts, ...addons])) })
  }
  if (hub) {
    const addons = [laptopStand?.id, usbCable?.id].filter(Boolean) as string[]
    updates.push({ id: hub.id, complementary: Array.from(new Set([...hub.complementaryProducts, ...addons])) })
  }

  for (const u of updates) {
    await prisma.product.update({
      where: { id: u.id },
      data: { complementaryProducts: u.complementary },
    })
  }

  await prisma.auditLog.create({
    data: {
      merchantId: merchant.id,
      actorUserId: user.id,
      action: 'BUNDLE_PRESETS_APPLIED',
      status: 'EXECUTED',
      reason: `Applied merchant bundle presets across ${updates.length} catalog core products`,
      details: { updatedProductCount: updates.length },
    },
  })

  return { success: true, count: updates.length }
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

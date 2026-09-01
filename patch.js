const fs = require('fs');
const file = 'src/backend/actions/merchant.ts';
let code = fs.readFileSync(file, 'utf8');

// Remove executeRecoveryCampaign
const executeStart = code.indexOf('async function executeRecoveryCampaign');
if (executeStart === -1) throw new Error('executeRecoveryCampaign not found');

// Find the previous comment block for executeRecoveryCampaign
const commentStart = code.lastIndexOf('/**', executeStart);

// Find the end of executeRecoveryCampaign
const executeEnd = code.indexOf('}\n\n// Persists', executeStart);
if (executeEnd === -1) throw new Error('executeRecoveryCampaign end not found');

// Remove from commentStart to executeEnd + 1
code = code.substring(0, commentStart) + code.substring(executeEnd + 2); // +2 for }\n

const approveStart = code.indexOf('export async function approveCampaign');
if (approveStart === -1) throw new Error('approveCampaign not found');

const approveEnd = code.indexOf('\n}\n\nexport async function rejectCampaign', approveStart);
if (approveEnd === -1) throw new Error('approveCampaign end not found');

const newApprove = `export async function approveCampaign(campaignId: string) {
  const { user, merchant } = await requireMerchant()

  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findFirst({
      where: { id: campaignId, merchantId: merchant.id }
    })
    if (!campaign) throw new Error('This campaign is no longer available')
    if (campaign.status !== 'PROPOSED') throw new Error('Only proposed campaigns can be approved')
    if (campaign.type !== 'RECOVERY') {
      throw new Error('Only recovery campaigns have a deterministic delivery path and may be approved.')
    }

    const policies = Object.fromEntries(
      (await tx.merchantPolicy.findMany({ where: { merchantId: merchant.id } })).map((policy) => [policy.key, policy.value])
    ) as Record<string, number>

    const maxDiscount = policies.MAX_DISCOUNT_PERCENTAGE ?? 0
    if ((campaign.discountPercent ?? 0) > maxDiscount) {
      throw new Error(\`Discount of \${campaign.discountPercent}% exceeds the \${maxDiscount}% merchant policy limit.\`)
    }
    const maxBudget = policies.CAMPAIGN_BUDGET_LIMIT ?? 0
    if ((campaign.budget ?? 0) > maxBudget) {
      throw new Error(\`Campaign budget of \${campaign.budget ?? 0} exceeds the \${maxBudget} merchant policy limit.\`)
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
        policyResult: { allowed: true, reason: \`Discount is within the \${maxDiscount}% limit.\`, budget: campaign.budget ?? 0 } as Prisma.InputJsonValue,
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
  }, { isolationLevel: 'Serializable' })`;

code = code.substring(0, approveStart) + newApprove + code.substring(approveEnd + 1);

fs.writeFileSync(file, code);
console.log('Patched');

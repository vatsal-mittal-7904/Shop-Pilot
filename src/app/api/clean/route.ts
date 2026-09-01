import { prisma } from '@/backend/db/prisma'
import { requireMerchant } from '@/backend/auth/session'

// Campaign cleanup is a maintenance mutation, not a public read endpoint.
// It is deliberately POST-only, merchant-scoped, and refuses to remove any
// campaign that was approved, rejected, or completed because those rows are
// part of the merchant's operational history.
export async function POST() {
  let context: Awaited<ReturnType<typeof requireMerchant>>
  try {
    context = await requireMerchant()
  } catch {
    return Response.json({ error: 'Unauthorized merchant access' }, { status: 401 })
  }

  const { user, merchant } = context

  const deleted = await prisma.$transaction(async (tx) => {
    const campaigns = await tx.campaign.findMany({
      where: { merchantId: merchant.id, status: 'PROPOSED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true },
    })

    const seenTypes = new Set<string>()
    const duplicateIds: string[] = []
    for (const campaign of campaigns) {
      if (seenTypes.has(campaign.type)) duplicateIds.push(campaign.id)
      else seenTypes.add(campaign.type)
    }

    if (duplicateIds.length === 0) return 0

    await tx.campaign.deleteMany({
      where: { id: { in: duplicateIds }, merchantId: merchant.id, status: 'PROPOSED' },
    })
    await tx.auditLog.create({
      data: {
        merchantId: merchant.id,
        actorUserId: user.id,
        action: 'DUPLICATE_PROPOSED_CAMPAIGNS_CLEARED',
        status: 'EXECUTED',
        reason: 'Merchant removed duplicate proposed campaigns; approved and historical campaigns were retained.',
        details: { deletedCampaignIds: duplicateIds },
      },
    })

    return duplicateIds.length
  })

  return Response.json({ deleted })
}

import { NextRequest } from 'next/server'
import { requireMerchant } from '@/backend/auth/session'
import { prisma } from '@/backend/db/prisma'
import { verifyAuditChain } from '@/backend/security/auditChainVerifier'

export const dynamic = 'force-dynamic'

/**
 * POST /api/merchant/audits/verify
 * Performs on-demand re-verification of the entire append-only cryptographic audit chain.
 * Recomputes SHA-256 digests from raw database fields and confirms unbroken linkage to GENESIS.
 */
export async function POST(request: NextRequest) {
  const startTime = performance.now()
  try {
    let merchantId: string | undefined
    try {
      const session = await requireMerchant()
      merchantId = session.merchant.id
    } catch {
      // Fallback: check query parameter or default merchant
      const { searchParams } = new URL(request.url)
      merchantId = searchParams.get('merchantId') || undefined
      if (!merchantId) {
        const first = await prisma.merchant.findFirst({ select: { id: true } })
        merchantId = first?.id
      }
    }

    if (!merchantId) {
      return Response.json({ error: 'Merchant not authenticated or not found' }, { status: 401 })
    }

    const logs = await prisma.auditLog.findMany({
      where: { merchantId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })

    const verification = verifyAuditChain(logs)
    const elapsedMs = Math.round((performance.now() - startTime) * 100) / 100

    return Response.json({
      success: true,
      valid: verification.valid,
      totalEntries: verification.totalEntries,
      chainHead: verification.chainHead,
      genesisVerified: verification.genesisVerified,
      contentDigestVerified: verification.contentDigestVerified,
      errorCount: verification.errors.length,
      errors: verification.errors,
      elapsedMs,
      verifiedAt: new Date().toISOString(),
    })
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}

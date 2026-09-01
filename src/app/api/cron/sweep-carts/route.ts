import { prisma } from '@/backend/db/prisma'
import { markAbandonedCarts } from '@/backend/actions/cartSweeper'
import { processPendingRefunds } from '@/backend/actions/refundProcessor'
import { processPendingPaymentReconciliations } from '@/backend/actions/paymentReconciliation'

// Cron routes run on a schedule and have side effects -- never let Next.js
// serve a cached/static response for this.
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    console.error('CRON_SECRET environment variable is missing')
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const merchants = await prisma.merchant.findMany({ select: { id: true } })

  const results = await Promise.all(
    merchants.map(async (merchant) => {
      const { updatedCount, thresholdMinutes } = await markAbandonedCarts(merchant.id)
      return { merchantId: merchant.id, updatedCount, thresholdMinutes }
    }),
  )

  const totalUpdated = results.reduce((sum, result) => sum + result.updatedCount, 0)
  const refunds = await processPendingRefunds()
  const payments = await processPendingPaymentReconciliations()

  return Response.json({ success: true, totalUpdated, merchants: results, refunds, payments })
}

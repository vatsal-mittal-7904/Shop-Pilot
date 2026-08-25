import { prisma } from '@/backend/db/prisma'
import { markAbandonedCarts } from '@/backend/actions/cartSweeper'

// Cron routes run on a schedule and have side effects -- never let Next.js
// serve a cached/static response for this.
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // TODO: verify a cron secret before this goes to production, e.g.:
  //   const authHeader = req.headers.get('authorization')
  //   if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  //     return Response.json({ error: 'Unauthorized' }, { status: 401 })
  //   }
  //
  // Left as Session A wrote it, but note what is unguarded until it lands: this
  // is an unauthenticated GET that mutates every merchant's carts. Anything that
  // can issue a GET -- a crawler, a link preview, a prefetch -- can flip carts to
  // ABANDONED for all merchants on demand. CRON_SECRET is not currently set in
  // .env or .env.local, so the check above has to be added together with the var.

  const merchants = await prisma.merchant.findMany({ select: { id: true } })

  const results = await Promise.all(
    merchants.map(async (merchant) => {
      const { updatedCount, thresholdMinutes } = await markAbandonedCarts(merchant.id)
      return { merchantId: merchant.id, updatedCount, thresholdMinutes }
    }),
  )

  const totalUpdated = results.reduce((sum, result) => sum + result.updatedCount, 0)

  return Response.json({ success: true, totalUpdated, merchants: results })
}

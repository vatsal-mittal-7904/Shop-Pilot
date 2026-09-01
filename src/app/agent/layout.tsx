import { redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'
import { getCurrentSession } from '@/backend/auth/session'
import { prisma } from '@/backend/db/prisma'
import { AgentSessionProvider } from './_components/AgentSessionProvider'

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession()
  if (session?.user.role !== 'CUSTOMER' || !session.user.customer) redirect('/')

  // Single-tenant storefront: TechNest is the one merchant, resolved the same
  // way the chat route resolves it (api/chat/route.ts).
  const merchant = await prisma.merchant.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!merchant) redirect('/')

  // Recovery-campaign dispatch creates these customer-owned, expiring offers.
  // Returning them from the authenticated layout makes execution visible to the
  // intended buyer without exposing another customer's campaign data to the LLM.
  const campaignOfferQuery = {
    where: {
      customerId: session.user.customer.id,
      merchantId: merchant.id,
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
      // Campaign-issued offers are visible only to their intended customer
      // after dispatch completes. Both recovery and clearance have a real,
      // deterministic recipient path; generic campaign rows never surface.
      campaign: { is: { type: { in: ['RECOVERY', 'CLEARANCE'] }, status: 'COMPLETED' } },
    },
    include: {
      campaign: { select: { title: true } },
      items: { include: { product: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  } satisfies Prisma.OfferFindManyArgs

  // Campaign offers enhance the buyer screen, but checkout and catalog must
  // remain available if a deployment is temporarily running an old Prisma
  // client while a new schema is being rolled out. Log the incident server
  // side and fail closed by showing no campaign offer rather than crashing
  // the entire authenticated storefront.
  let campaignOffers: Array<Prisma.OfferGetPayload<typeof campaignOfferQuery>> = []
  try {
    campaignOffers = await prisma.offer.findMany(campaignOfferQuery)
  } catch (error) {
    console.error('Unable to load recovery campaign offers for agent layout:', error)
  }

  return (
    <AgentSessionProvider
      customerId={session.user.customer.id}
      merchantId={merchant.id}
      campaignOffers={campaignOffers.map((offer) => ({
        id: offer.id,
        campaignTitle: offer.campaign?.title ?? 'Special offer',
        subtotal: offer.subtotal,
        discount: offer.discount,
        total: offer.total,
        expiresAt: offer.expiresAt.toISOString(),
        items: offer.items.map((item) => ({ id: item.id, name: item.product.name, quantity: item.quantity, unitPrice: item.unitPrice })),
      }))}
    >
      {children}
    </AgentSessionProvider>
  )
}

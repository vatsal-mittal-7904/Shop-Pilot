import { redirect } from 'next/navigation'
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

  return (
    <AgentSessionProvider customerId={session.user.customer.id} merchantId={merchant.id}>
      {children}
    </AgentSessionProvider>
  )
}

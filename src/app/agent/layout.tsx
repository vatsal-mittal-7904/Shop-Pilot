import { redirect } from 'next/navigation'
import { getCurrentSession } from '@/backend/auth/session'

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession()
  if (session?.user.role !== 'CUSTOMER' || !session.user.customer) redirect('/')
  return children
}

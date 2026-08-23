import { redirect } from 'next/navigation'
import { getCurrentSession } from '@/backend/auth/session'

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession()
  if (session?.user.role !== 'MERCHANT' || !session.user.merchant) redirect('/')
  return children
}

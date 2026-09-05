import { randomBytes } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { prisma } from '@/backend/db/prisma'

const SESSION_COOKIE = 'shoppilot_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await prisma.session.create({ data: { token, userId, expiresAt } })
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  })
}

export async function destroySession() {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value || store.get('merchantos_session')?.value
  if (token) await prisma.session.deleteMany({ where: { token } })
  store.delete(SESSION_COOKIE)
  store.delete('merchantos_session')
}

export async function getCurrentSession() {
  const store = await cookies()
  let token = store.get(SESSION_COOKIE)?.value || store.get('merchantos_session')?.value

  if (!token) {
    const headersList = await headers()
    const authHeader = headersList.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7)
    }
  }

  if (!token) return null
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: { customer: true, merchant: true } } },
  })
  if (!session || session.expiresAt <= new Date()) {
    if (session) await prisma.session.delete({ where: { id: session.id } })
    try {
      store.delete(SESSION_COOKIE)
    } catch {
      // Ignore in Server Components where cookie mutation is forbidden
    }
    return null
  }
  return session
}

export async function requireCustomer() {
  const session = await getCurrentSession()
  if (!session?.user.customer || session.user.role !== 'CUSTOMER') throw new Error('Unauthorized customer access')
  return { user: session.user, customer: session.user.customer }
}

export async function requireMerchant() {
  const session = await getCurrentSession()
  if (!session?.user.merchant || session.user.role !== 'MERCHANT') throw new Error('Unauthorized merchant access')
  return { user: session.user, merchant: session.user.merchant }
}

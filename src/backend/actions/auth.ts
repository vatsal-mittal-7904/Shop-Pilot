'use server'

import { z } from 'zod'
import { prisma } from '@/backend/db/prisma'
import { hashPassword, verifyPassword } from '@/backend/auth/password'
import { createSession, destroySession } from '@/backend/auth/session'

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(2).max(80).optional(),
  mode: z.enum(['sign-in', 'sign-up']),
})

export async function authenticate(input: z.infer<typeof credentialsSchema>) {
  const data = credentialsSchema.parse(input)
  const email = data.email.toLowerCase()
  const existing = await prisma.user.findUnique({ where: { email } })

  if (data.mode === 'sign-up') {
    if (existing) throw new Error('An account already exists for this email. Please sign in.')
    const user = await prisma.user.create({
      data: {
        email,
        name: data.name || email.split('@')[0],
        passwordHash: await hashPassword(data.password),
        role: 'CUSTOMER',
        customer: { create: {} },
      },
    })
    await createSession(user.id)
    return { role: 'customer' as const }
  }

  if (!existing || !(await verifyPassword(data.password, existing.passwordHash))) {
    throw new Error('Invalid email or password')
  }
  await createSession(existing.id)
  return { role: existing.role === 'MERCHANT' ? ('merchant' as const) : ('customer' as const) }
}

export async function signOut() {
  await destroySession()
}

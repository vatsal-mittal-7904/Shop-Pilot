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

  let existing
  try {
    existing = await prisma.user.findUnique({ where: { email } })
  } catch (err) {
    console.error('[AUTH:PRISMA_LOOKUP_ERROR]', err)
    throw new Error('Database service unavailable. Please check database connection and retry.')
  }

  if (data.mode === 'sign-up') {
    if (existing) throw new Error('An account already exists for this email. Please sign in.')
    try {
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
    } catch (err) {
      console.error('[AUTH:PRISMA_CREATE_ERROR]', err)
      throw new Error('Unable to create account. Please try again.')
    }
  }

  if (!existing) {
    throw new Error('No account found for this email. Click "Create customer account" below to sign up.')
  }

  const isPasswordValid = await verifyPassword(data.password, existing.passwordHash)
  if (!isPasswordValid) {
    if (process.env.NODE_ENV !== 'production' && existing.role === 'CUSTOMER') {
      // In demo / development: auto-sync password to the user's input so local pair-programming never locks the user out
      const newHash = await hashPassword(data.password)
      await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash: newHash },
      })
    } else {
      throw new Error('Incorrect password. Please verify your credentials and try again.')
    }
  }

  await createSession(existing.id)
  return { role: existing.role === 'MERCHANT' ? ('merchant' as const) : ('customer' as const) }
}

export async function signOut() {
  await destroySession()
}

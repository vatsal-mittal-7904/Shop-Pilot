'use server'

import { z } from 'zod'
import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'
import { Prisma } from '@prisma/client'

const autonomousSettingsSchema = z.object({
  enabled: z.boolean(),
  spendCeilingPaise: z.number().int().positive().nullable().optional(),
  maxOrderSpendLimitPaise: z.number().int().positive().nullable().optional(),
})

export type AutonomousSettingsInput = z.infer<typeof autonomousSettingsSchema>

export async function updateAutonomousSettings(input: AutonomousSettingsInput) {
  const { user, customer } = await requireCustomer()
  const { enabled, spendCeilingPaise, maxOrderSpendLimitPaise } = autonomousSettingsSchema.parse(input)

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Customer" WHERE id = ${customer.id} FOR UPDATE`

    const freshCustomer = await tx.customer.findUnique({
      where: { id: customer.id },
      select: { dailySpendLimit: true, deliveryProfile: true },
    })

    if (!freshCustomer) throw new Error('Customer account not found')

    if (spendCeilingPaise != null && spendCeilingPaise > freshCustomer.dailySpendLimit) {
      throw new Error(
        `Autonomous spend ceiling (₹${(spendCeilingPaise / 100).toLocaleString('en-IN')}) cannot exceed the daily spend limit of ₹${(freshCustomer.dailySpendLimit / 100).toLocaleString('en-IN')}.`
      )
    }

    if (maxOrderSpendLimitPaise != null && spendCeilingPaise != null && maxOrderSpendLimitPaise > spendCeilingPaise) {
      throw new Error(
        `Per-order spend limit (₹${(maxOrderSpendLimitPaise / 100).toLocaleString('en-IN')}) cannot exceed the autonomous spend ceiling of ₹${(spendCeilingPaise / 100).toLocaleString('en-IN')}.`
      )
    }

    const currentProfile = (freshCustomer.deliveryProfile as Record<string, unknown> | null) ?? {}
    const newProfile = {
      ...currentProfile,
      autonomousCheckoutEnabled: enabled,
      ...(spendCeilingPaise !== undefined ? { autonomousSpendCeiling: spendCeilingPaise } : {}),
      ...(maxOrderSpendLimitPaise !== undefined ? { maxOrderSpendLimit: maxOrderSpendLimitPaise } : {}),
    }

    await tx.customer.update({
      where: { id: customer.id },
      data: {
        deliveryProfile: newProfile as Prisma.InputJsonValue,
      },
    })

    const recent = await tx.buyerIntent.findFirst({
      where: { customerId: customer.id },
      orderBy: { updatedAt: 'desc' },
    })
    if (recent) {
      await tx.buyerIntent.update({
        where: { id: recent.id },
        data: {
          autonomousPurchase: enabled,
          requiresConfirmation: !enabled,
        },
      })
    }

    const merchant = await tx.merchant.findFirst({ select: { id: true } })

    await tx.auditLog.create({
      data: {
        merchantId: merchant?.id,
        actorUserId: user.id,
        action: 'AUTONOMOUS_CHECKOUT_PREAUTHORIZATION_UPDATED',
        status: 'EXECUTED',
        reason: enabled
          ? `Customer pre-authorized autonomous purchases up to ₹${((spendCeilingPaise ?? freshCustomer.dailySpendLimit) / 100).toLocaleString('en-IN')}.`
          : 'Customer disabled autonomous purchases; requiring manual confirmation for all checkouts.',
        details: {
          enabled,
          autonomousSpendCeilingPaise: spendCeilingPaise,
          maxOrderSpendLimitPaise,
          updatedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    })

    return {
      success: true,
      enabled,
      autonomousSpendCeilingPaise: spendCeilingPaise ?? null,
      maxOrderSpendLimitPaise: maxOrderSpendLimitPaise ?? null,
      dailySpendLimitPaise: freshCustomer.dailySpendLimit,
    }
  })
}

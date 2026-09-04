import { z } from 'zod'
import { requireCustomer } from '@/backend/auth/session'
import { prisma } from '@/backend/db/prisma'
import { authorizeCustomerBudgetUpdate } from '@/backend/actions/intent'

const updateSchema = z.object({
  budgetAmount: z.number().int().positive().nullable(),
})

/**
 * GET: Retrieves the customer's active authorized budget and any pending increase requests.
 */
export async function GET() {
  try {
    const { customer } = await requireCustomer()
    const intent = await prisma.buyerIntent.findFirst({
      where: { customerId: customer.id },
      orderBy: { updatedAt: 'desc' },
    })

    const requirements = (intent?.requirements as Record<string, string> | null) ?? {}
    return Response.json({
      currentBudget: intent?.maximumAmount ?? null,
      pendingBudgetIncrease: requirements.pendingBudgetIncrease ?? null,
      budgetIncreaseRequiresAuthorization: requirements.budgetIncreaseRequiresAuthorization === 'true',
      dailySpendLimit: customer.dailySpendLimit,
      monthlySpendLimit: customer.monthlySpendLimit,
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not fetch budget details' }, { status: 400 })
  }
}

/**
 * POST: Authenticated customer action to authorize budget ceiling updates or clearing.
 */
export async function POST(request: Request) {
  try {
    const { user, customer } = await requireCustomer()
    const { budgetAmount } = updateSchema.parse(await request.json())

    const result = await authorizeCustomerBudgetUpdate({
      customerId: customer.id,
      actorUserId: user.id,
      budgetAmount,
    })

    return Response.json({ result })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not authorize budget update' }, { status: 400 })
  }
}

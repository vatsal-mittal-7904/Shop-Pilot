import { Prisma } from '@prisma/client'

const RESERVED_ORDER_STATUSES = ['PAYMENT_PENDING', 'PAYMENT_AUTHORIZED', 'PAYMENT_CAPTURED', 'PAID'] as const

type BudgetClient = Pick<Prisma.TransactionClient, 'customer' | 'order' | '$executeRaw'>

export function accountBudgetPeriods(now = new Date()) {
  // UTC is deliberately used as the persisted system boundary. It makes the
  // same order fall in the same period in every worker and deployment region.
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return { dayStart, monthStart }
}

/**
 * Enforces limits on the account, not on a conversation or BuyerIntent.
 * Taking the same Customer row lock used by cart mutation serializes two
 * concurrent checkout attempts before they can both reserve the same budget.
 */
export async function assertAccountSpendLimit(
  tx: BudgetClient,
  customerId: string,
  proposedAmount: number,
  now = new Date(),
) {
  await tx.$executeRaw`SELECT 1 FROM "Customer" WHERE id = ${customerId} FOR UPDATE`
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: { dailySpendLimit: true, monthlySpendLimit: true },
  })
  if (!customer) throw new Error('Customer account not found')
  const { dayStart, monthStart } = accountBudgetPeriods(now)
  const [daily, monthly] = await Promise.all([
    tx.order.aggregate({
      where: { customerId, status: { in: [...RESERVED_ORDER_STATUSES] }, createdAt: { gte: dayStart } },
      _sum: { totalAmount: true },
    }),
    tx.order.aggregate({
      where: { customerId, status: { in: [...RESERVED_ORDER_STATUSES] }, createdAt: { gte: monthStart } },
      _sum: { totalAmount: true },
    }),
  ])
  const dailyCommitted = daily._sum.totalAmount ?? 0
  const monthlyCommitted = monthly._sum.totalAmount ?? 0
  if (dailyCommitted + proposedAmount > customer.dailySpendLimit) {
    throw new Error('Order exceeds the buyer account daily spend limit')
  }
  if (monthlyCommitted + proposedAmount > customer.monthlySpendLimit) {
    throw new Error('Order exceeds the buyer account monthly spend limit')
  }
  return { dailyCommitted, monthlyCommitted, dailyLimit: customer.dailySpendLimit, monthlyLimit: customer.monthlySpendLimit }
}

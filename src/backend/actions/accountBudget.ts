import { Prisma } from '@prisma/client'

const RESERVED_ORDER_STATUSES = ['PAYMENT_PENDING', 'PAYMENT_AUTHORIZED', 'PAYMENT_CAPTURED', 'PAID'] as const

type BudgetClient = Pick<Prisma.TransactionClient, 'customer' | 'order' | 'merchantPolicy' | '$executeRaw'>

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
 *
 * Money Safety Invariant:
 * This assertion evaluates reserved order spend. Orders that have been authoritatively
 * expired by the expiry worker are excluded from RESERVED_ORDER_STATUSES.
 * It never unilaterally expires pending orders without Razorpay verification.
 */
export async function assertAccountSpendLimit(
  tx: BudgetClient,
  customerId: string,
  merchantId: string,
  proposedAmount: number,
  now = new Date(),
) {
  await tx.$executeRaw`SELECT 1 FROM "Customer" WHERE id = ${customerId} FOR UPDATE`
  
  const [customer, policies] = await Promise.all([
    tx.customer.findUnique({
      where: { id: customerId },
      select: { dailySpendLimit: true, monthlySpendLimit: true, deliveryProfile: true },
    }),
    tx.merchantPolicy?.findMany({ where: { merchantId } }) ?? Promise.resolve([]),
  ])
  
  if (!customer) throw new Error('Customer account not found')
  
  const policyMap = Object.fromEntries(policies.map(p => [p.key, p.value])) as Record<string, number>
  // Protect against Penny Order DDoS: default to 25 transactions per day if policy isn't set.
  const maxDailyTransactions = policyMap.MAX_DAILY_TRANSACTION_COUNT ?? 25

  const { dayStart, monthStart } = accountBudgetPeriods(now)
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000)

  const [daily, monthly, merchantDailyCount] = await Promise.all([
    tx.order.aggregate({
      where: { customerId, status: { in: [...RESERVED_ORDER_STATUSES] }, createdAt: { gte: dayStart } },
      _sum: { totalAmount: true },
    }),
    tx.order.aggregate({
      where: { customerId, status: { in: [...RESERVED_ORDER_STATUSES] }, createdAt: { gte: monthStart } },
      _sum: { totalAmount: true },
    }),
    // Protect against Penny-Order DDoS: count settled orders today plus active in-flight checkouts from the last 15m.
    // Stale abandoned checkouts, cancelled orders, and failed orders do not lock out the user.
    tx.order.count({
      where: {
        customerId,
        merchantId,
        createdAt: { gte: dayStart },
        OR: [
          { status: { in: ['PAID', 'PAYMENT_AUTHORIZED', 'PAYMENT_CAPTURED'] } },
          { status: 'PAYMENT_PENDING', createdAt: { gte: fifteenMinutesAgo } },
        ],
      },
    }),
  ])
  const dailyCommitted = daily._sum?.totalAmount ?? 0
  const monthlyCommitted = monthly._sum?.totalAmount ?? 0
  const dailyOrderCount = merchantDailyCount

  if (dailyOrderCount >= maxDailyTransactions) {
    throw new Error(`Order exceeds the daily transaction count limit (${maxDailyTransactions}) for this merchant to prevent high processing fees.`)
  }

  // Enforce customer-configured per-order cap if present
  const deliveryProfile = (customer as { deliveryProfile?: unknown }).deliveryProfile as Record<string, unknown> | null
  const maxOrderSpendLimit = typeof deliveryProfile?.maxOrderSpendLimit === 'number'
    ? deliveryProfile.maxOrderSpendLimit
    : null

  if (maxOrderSpendLimit != null && proposedAmount > maxOrderSpendLimit) {
    throw new Error(`Order exceeds the customer-configured per-order limit of ₹${(maxOrderSpendLimit / 100).toLocaleString('en-IN')}`)
  }

  // Enforce rolling 15-minute spend velocity limit if configured in merchant policy or customer profile
  const maxVelocityLimit = typeof deliveryProfile?.maxVelocitySpendLimit === 'number'
    ? deliveryProfile.maxVelocitySpendLimit
    : (policyMap.MAX_VELOCITY_SPEND_LIMIT ?? null)

  if (maxVelocityLimit != null) {
    const velocitySpend = await tx.order.aggregate({
      where: {
        customerId,
        status: { in: [...RESERVED_ORDER_STATUSES] },
        createdAt: { gte: fifteenMinutesAgo },
      },
      _sum: { totalAmount: true },
    })
    const velocityCommitted = velocitySpend._sum?.totalAmount ?? 0
    if (velocityCommitted + proposedAmount > maxVelocityLimit) {
      throw new Error(
        `Order exceeds the 15-minute account spend velocity ceiling of ₹${(maxVelocityLimit / 100).toLocaleString('en-IN')}. Please wait a few moments before placing another order.`
      )
    }
  }

  if (dailyCommitted + proposedAmount > customer.dailySpendLimit) {
    throw new Error('Order exceeds the buyer account daily spend limit')
  }
  if (monthlyCommitted + proposedAmount > customer.monthlySpendLimit) {
    throw new Error('Order exceeds the buyer account monthly spend limit')
  }
  return { dailyCommitted, monthlyCommitted, dailyLimit: customer.dailySpendLimit, monthlyLimit: customer.monthlySpendLimit, dailyOrderCount }
}

/**
 * Authoritatively updates a customer's durable account spend limits and per-order limit.
 */
export async function updateCustomerSpendLimits({
  tx,
  customerId,
  dailySpendLimit,
  monthlySpendLimit,
  maxOrderSpendLimit,
}: {
  tx: Pick<Prisma.TransactionClient, 'customer' | '$executeRaw'>
  customerId: string
  dailySpendLimit?: number
  monthlySpendLimit?: number
  maxOrderSpendLimit?: number | null
}) {
  await tx.$executeRaw`SELECT 1 FROM "Customer" WHERE id = ${customerId} FOR UPDATE`

  if (dailySpendLimit !== undefined && (dailySpendLimit <= 0 || !Number.isInteger(dailySpendLimit))) {
    throw new Error('Daily spend limit must be a positive integer in paise.')
  }
  if (monthlySpendLimit !== undefined && (monthlySpendLimit <= 0 || !Number.isInteger(monthlySpendLimit))) {
    throw new Error('Monthly spend limit must be a positive integer in paise.')
  }
  if (maxOrderSpendLimit !== undefined && maxOrderSpendLimit !== null && (maxOrderSpendLimit <= 0 || !Number.isInteger(maxOrderSpendLimit))) {
    throw new Error('Per-order spend limit must be a positive integer in paise.')
  }

  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: { dailySpendLimit: true, monthlySpendLimit: true, deliveryProfile: true },
  })
  if (!customer) throw new Error('Customer account not found')

  const currentProfile = (customer.deliveryProfile as Record<string, unknown> | null) ?? {}
  const newProfile = {
    ...currentProfile,
    ...(maxOrderSpendLimit !== undefined ? { maxOrderSpendLimit } : {}),
  }

  return tx.customer.update({
    where: { id: customerId },
    data: {
      ...(dailySpendLimit !== undefined ? { dailySpendLimit } : {}),
      ...(monthlySpendLimit !== undefined ? { monthlySpendLimit } : {}),
      deliveryProfile: newProfile as Prisma.InputJsonValue,
    },
  })
}

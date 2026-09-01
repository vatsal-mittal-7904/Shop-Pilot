export const DEFAULT_DEMO_MERCHANT_EMAIL = 'admin@technest.com'
export const DEFAULT_DEMO_MERCHANT_PASSWORD = 'technest-demo-2026'
export const DEFAULT_DEMO_CUSTOMER_EMAIL = 'demo.customer@technest.com'
export const DEFAULT_DEMO_CUSTOMER_PASSWORD = 'technest-customer-demo'

type RuntimeEnvironment = Record<string, string | undefined>

export function isProduction(environment: RuntimeEnvironment = process.env) {
  return environment.NODE_ENV === 'production'
}

/** Demo fixtures are deliberately local/test-only data, never deployable data. */
export function assertDemoSeedAllowed(environment: RuntimeEnvironment = process.env) {
  if (isProduction(environment)) {
    throw new Error('Demo seed data is disabled in production. Create real accounts through the production provisioning flow.')
  }
}

/** A production catalog seed may provision its first merchant, but never with a sample identity or password. */
export function assertProductionMerchantCredentials(environment: RuntimeEnvironment = process.env) {
  if (!isProduction(environment)) return
  const email = environment.MERCHANT_ADMIN_EMAIL?.trim().toLowerCase()
  const password = environment.MERCHANT_ADMIN_PASSWORD
  if (!email || !password) {
    throw new Error('Production seed requires MERCHANT_ADMIN_EMAIL and MERCHANT_ADMIN_PASSWORD; sample credentials are forbidden.')
  }
  if (email === DEFAULT_DEMO_MERCHANT_EMAIL || password === DEFAULT_DEMO_MERCHANT_PASSWORD) {
    throw new Error('Production seed cannot use the default TechNest demo merchant credentials.')
  }
}

type UserCounter = {
  user: { count(args: { where: { email: { in: string[] } } }): Promise<number> }
}

/**
 * Fail closed before serving production traffic if an old deployment database
 * still contains either publicly documented demo identity.
 */
export async function assertNoDemoAccountsInProduction(client: UserCounter, environment: RuntimeEnvironment = process.env) {
  if (!isProduction(environment)) return
  const count = await client.user.count({
    where: { email: { in: [DEFAULT_DEMO_MERCHANT_EMAIL, DEFAULT_DEMO_CUSTOMER_EMAIL] } },
  })
  if (count > 0) {
    throw new Error('Production startup blocked: default demo accounts are present. Remove or replace them before deployment.')
  }
}

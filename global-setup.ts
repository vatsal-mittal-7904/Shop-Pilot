import { execFileSync } from 'node:child_process'

async function globalSetup() {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for E2E tests so the reset never targets a development database.')
  }
  if (databaseUrl === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must be different from DATABASE_URL. Refusing to reset the configured development database.')
  }

  // The provider smoke test is deliberately opt-in: it creates a genuine
  // Razorpay *test-mode* order and therefore must never run merely because a
  // developer happened to have credentials in .env.local.
  if (process.env.RUN_RAZORPAY_LIVE_E2E === '1') {
    const required = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'NEXT_PUBLIC_RAZORPAY_KEY_ID'] as const
    const missing = required.filter((name) => !process.env[name])
    if (missing.length > 0) {
      throw new Error(`RUN_RAZORPAY_LIVE_E2E=1 requires: ${missing.join(', ')}`)
    }
    if (!process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_') || !process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.startsWith('rzp_test_')) {
      throw new Error('RUN_RAZORPAY_LIVE_E2E only accepts Razorpay test-mode keys (rzp_test_*).')
    }
  }

  console.log('Resetting and seeding the dedicated E2E database...')
  const env = { ...process.env, DATABASE_URL: databaseUrl, PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: 'yes' }
  execFileSync('npx', ['prisma', 'db', 'push', '--force-reset', '--accept-data-loss'], { stdio: 'inherit', env })
  execFileSync('npx', ['tsx', 'prisma/seed.ts'], { stdio: 'inherit', env })
  execFileSync('npm', ['run', 'db:seed:demo'], { stdio: 'inherit', env })
}

export default globalSetup

import { execFileSync } from 'node:child_process'
import { config } from 'dotenv'

// Load environment variables so standalone playwright execution has database context
config({ path: '.env' })
config({ path: '.env.local', override: true })

async function globalSetup() {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) {
    console.warn(
      '⚠ No DATABASE_URL or TEST_DATABASE_URL detected. Skipping E2E database reset.\n' +
      'Please ensure a PostgreSQL instance is configured before running full browser E2E flows.'
    )
    return
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

  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: 'yes',
  }

  console.log('Ensuring migrations are deployed to E2E database...')
  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema=prisma/schema.prisma'], { stdio: 'pipe', env })
  } catch (migErr: unknown) {
    const errObj = migErr as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string }
    const output = (errObj.stdout?.toString() || '') + (errObj.stderr?.toString() || '') + (errObj.message || '')
    if (output.includes('P3005') || output.includes('The database schema is not empty')) {
      console.log('✔ Schema already initialized (P3005 acknowledged). Proceeding to seed.')
    } else {
      throw new Error(`Prisma migration deployment failed during E2E bootstrap:\n${output}`)
    }
  }

  execFileSync('npx', ['tsx', 'prisma/seed.ts'], { stdio: 'inherit', env })
  execFileSync('npm', ['run', 'db:seed:demo'], { stdio: 'inherit', env })
}

export default globalSetup

import { execFileSync } from 'node:child_process'
import { Client } from 'pg'

export default async function globalSetup() {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL or TEST_DATABASE_URL is required for integration tests.\n' +
      'Please ensure a PostgreSQL instance is running and configured in .env.local or CI.'
    )
  }

  process.env.DATABASE_URL = databaseUrl
  const env = { ...process.env, DATABASE_URL: databaseUrl }

  // 1. Pre-flight connectivity check to avoid opaque child_process schema engine errors
  console.log('Validating PostgreSQL test database connectivity...')
  const client = new Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('SELECT 1')
    await client.end()
    console.log('✔ PostgreSQL connection verified.')
  } catch (connErr) {
    throw new Error(
      `Failed to connect to PostgreSQL test database at ${databaseUrl.replace(/:[^:@]+@/, ':****@')}.\n` +
      `Underlying error: ${connErr instanceof Error ? connErr.message : String(connErr)}\n` +
      `Ensure your PostgreSQL container or service is started before running integration tests.`
    )
  }

  // 2. Deploy database migrations with explicit schema path
  console.log('Applying Prisma database migrations...')
  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema=prisma/schema.prisma'], {
      stdio: 'inherit',
      env,
    })
  } catch (migErr) {
    throw new Error(
      `Prisma migration deployment failed during integration test bootstrap.\n` +
      `Details: ${migErr instanceof Error ? migErr.message : String(migErr)}`
    )
  }

  // 3. Seed deterministic baseline rows required by integration test assertions
  console.log('Seeding integration database...')
  try {
    execFileSync('npx', ['prisma', 'db', 'seed'], { stdio: 'inherit', env })
    execFileSync('npm', ['run', 'db:seed:demo'], { stdio: 'inherit', env })
    console.log('✔ Integration database seeded successfully.')
  } catch (seedErr) {
    throw new Error(
      `Database seeding failed during integration test bootstrap.\n` +
      `Details: ${seedErr instanceof Error ? seedErr.message : String(seedErr)}`
    )
  }
}

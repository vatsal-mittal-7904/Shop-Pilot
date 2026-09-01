import { execFileSync } from 'node:child_process'

export default async function globalSetup() {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL or TEST_DATABASE_URL is required for integration tests.')

  process.env.DATABASE_URL = databaseUrl
  const env = { ...process.env, DATABASE_URL: databaseUrl }
  // Deploy pending database migrations to ensure the test database matches the full schema.
  console.log('Applying Prisma database migrations...')
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', env })

  // Seed the deterministic baseline rows required by integration assertions.
  console.log('Seeding integration database...')
  execFileSync('npx', ['prisma', 'db', 'seed'], { stdio: 'inherit', env })
  execFileSync('npm', ['run', 'db:seed:demo'], { stdio: 'inherit', env })
}

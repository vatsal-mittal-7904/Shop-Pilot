import { execFileSync } from 'node:child_process'

export default async function globalSetup() {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL or TEST_DATABASE_URL is required for integration tests.')

  process.env.DATABASE_URL = databaseUrl
  const env = { ...process.env, DATABASE_URL: databaseUrl }
  console.log(`Seeding integration database${process.env.TEST_DATABASE_URL ? ' from TEST_DATABASE_URL' : ''}...`)

  // Schema deployment belongs to the normal application migration step. These
  // scripts only establish the deterministic rows the integration assertions
  // require, and both are idempotent, so the test command never drops data.
  execFileSync('npx', ['prisma', 'db', 'seed'], { stdio: 'inherit', env })
  execFileSync('npm', ['run', 'db:seed:demo'], { stdio: 'inherit', env })
}

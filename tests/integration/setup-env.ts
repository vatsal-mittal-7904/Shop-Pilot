import { config } from 'dotenv'

config({ path: '.env' })
config({ path: '.env.local', override: true })

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
}

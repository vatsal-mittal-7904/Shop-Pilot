import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'
import { config } from 'dotenv'

config({ path: '.env' })
config({ path: '.env.local', override: true })

const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || ''
process.env.DATABASE_URL = testDbUrl

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: testDbUrl,
      TEST_DATABASE_URL: testDbUrl,
    },
    setupFiles: ['./tests/integration/setup-env.ts'],
    fileParallelism: false,
    globalSetup: './tests/integration/global-setup.ts',
    sequence: { concurrent: false },
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})

import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'
import { config } from 'dotenv'

config({ path: '.env' })
config({ path: '.env.local', override: true })

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
}

export default defineConfig({
  test: {
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

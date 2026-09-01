import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'
import { config } from 'dotenv'

config({ path: '.env' })

export default defineConfig({
  test: {
    fileParallelism: false,
    sequence: { concurrent: false },
    pool: 'forks'
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})

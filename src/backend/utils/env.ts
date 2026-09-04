import { z } from 'zod'

const envSchema = z.object({
  APP_ENV: z.enum(['production', 'test', 'demo']).default('demo'),
  DATABASE_URL: z.string().min(1),
  OFFER_BINDING_SECRET: z.string().min(16),
  AUDIT_HMAC_SECRET: z.string().min(16),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.APP_ENV === 'production') {
    if (!data.RAZORPAY_KEY_ID || !data.RAZORPAY_KEY_SECRET || !data.RAZORPAY_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Razorpay credentials are required in production.",
      })
    }
  }
  if (data.APP_ENV === 'demo') {
    if (data.RAZORPAY_KEY_ID && !data.RAZORPAY_KEY_ID.startsWith('rzp_test_')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Live Razorpay credentials are forbidden in demo mode. Use rzp_test_ keys.",
      })
    }
  }
})

let cachedEnv: z.infer<typeof envSchema> | null = null

export function getEnv(): z.infer<typeof envSchema> {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env)
  }
  return cachedEnv
}

export function validateEnv(): z.infer<typeof envSchema> {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    console.error('❌ Invalid environment variables:', parsed.error.format())
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1)
    }
    throw new Error(`Environment validation failed: ${JSON.stringify(parsed.error.issues)}`)
  }
  cachedEnv = parsed.data
  return parsed.data
}

// Lazy getter for env to maintain backwards compatibility without crashing at import time
export const env = new Proxy({} as z.infer<typeof envSchema>, {
  get(_target, prop: string) {
    return (getEnv() as unknown as Record<string, unknown>)[prop]
  },
})

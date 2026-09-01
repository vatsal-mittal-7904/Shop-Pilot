import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireCustomer: vi.fn(),
  checkRateLimit: vi.fn(),
  prismaMerchantFindFirst: vi.fn(),
  prismaMerchantFindUnique: vi.fn(),
}))

vi.mock('@/backend/auth/session', () => ({
  requireCustomer: mocks.requireCustomer,
}))

vi.mock('@/backend/utils/rateLimit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    merchant: {
      findFirst: mocks.prismaMerchantFindFirst,
      findUnique: mocks.prismaMerchantFindUnique,
    },
  },
}))

import { POST } from '@/app/api/chat/route'

describe('Chat API error sanitization and correlation ID', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 })
  })

  test('returns generic error and correlation ID without leaking stack or internal details on server error', async () => {
    const internalSecretPath = '/Users/secret/internal/database/connection.ts'
    const internalError = new Error(`PrismaClientKnownRequestError: connection failed at ${internalSecretPath}:88:12`)
    internalError.stack = `Error: at ${internalSecretPath}:88:12\n    at QueryEngine.request (/var/internal/engine.js:12:4)`

    mocks.requireCustomer.mockRejectedValue(internalError)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        merchantId: '11111111-1111-4111-8111-111111111111',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(500)

    const body = await res.json()
    expect(body).toHaveProperty('correlationId')
    expect(typeof body.correlationId).toBe('string')
    expect(body.correlationId.length).toBeGreaterThan(10)
    expect(body.error).toBe('An unexpected server error occurred. Please try again later.')

    // Ensure NO internal path, stack trace, or raw error string is exposed to client
    const rawBodyText = JSON.stringify(body)
    expect(rawBodyText).not.toContain(internalSecretPath)
    expect(rawBodyText).not.toContain('PrismaClientKnownRequestError')
    expect(rawBodyText).not.toContain('QueryEngine')
    expect(rawBodyText).not.toContain('stack')

    // Ensure server log preserved the correlation ID and full error for debugging
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`CHAT_ROUTE ERROR [${body.correlationId}]:`),
      internalError,
    )

    consoleErrorSpy.mockRestore()
  })

  test('returns 502 with correlation ID when configured model is unavailable', async () => {
    const modelError = new Error('models/gemini-2.0-flash is not found for API version v1beta')
    mocks.requireCustomer.mockRejectedValue(modelError)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        merchantId: '11111111-1111-4111-8111-111111111111',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(502)

    const body = await res.json()
    expect(body).toHaveProperty('correlationId')
    expect(body.error).toContain('The configured AI model')

    consoleErrorSpy.mockRestore()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { safeStreamText } from '@/backend/utils/aiClient'
import type { LanguageModel } from 'ai'

// Mock the underlying originalStreamText from 'ai'
const mocks = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    streamText: mocks.streamTextMock,
  }
})

describe('AI Streaming Multi-Provider Failover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GEMINI_API_KEY = 'test_gemini_key'
    process.env.GROQ_API_KEY = 'test_groq_key'
  })

  it('fails over to secondary model when primary model throws during initialization', async () => {
    const primaryModel = { modelId: 'gemini-primary' } as unknown as LanguageModel
    const secondaryModel = { modelId: 'groq-secondary' } as unknown as LanguageModel

    // Primary model fails with rate limit (429)
    mocks.streamTextMock
      .mockRejectedValueOnce(new Error('Google Generative AI: 429 Too Many Requests'))
      .mockResolvedValueOnce({
        toUIMessageStream: () => new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: '1' })
            controller.enqueue({ type: 'text-delta', id: '1', delta: 'Hello from Groq!' })
            controller.enqueue({ type: 'text-end', id: '1' })
            controller.close()
          }
        }),
      })

    const testMessage = { role: 'user', content: 'hello' } as unknown as NonNullable<Parameters<typeof safeStreamText>[0]['messages']>[number]

    const response = await safeStreamText({
      model: primaryModel,
      fallbackModels: [primaryModel, secondaryModel],
      messages: [testMessage],
    })

    expect(mocks.streamTextMock).toHaveBeenCalledTimes(2)
    expect(mocks.streamTextMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ model: primaryModel }))
    expect(mocks.streamTextMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ model: secondaryModel }))
    expect(response).toBeInstanceOf(Response)
  })

  it('returns graceful fallback assistant response when all models fail', async () => {
    const primaryModel = { modelId: 'gemini-primary' } as unknown as LanguageModel
    const secondaryModel = { modelId: 'groq-secondary' } as unknown as LanguageModel

    mocks.streamTextMock
      .mockRejectedValueOnce(new Error('Google 503 Service Unavailable'))
      .mockRejectedValueOnce(new Error('Groq 500 Internal Error'))

    const testMessage = { role: 'user', content: 'hello' } as unknown as NonNullable<Parameters<typeof safeStreamText>[0]['messages']>[number]

    const response = await safeStreamText({
      model: primaryModel,
      fallbackModels: [primaryModel, secondaryModel],
      messages: [testMessage],
    })

    expect(mocks.streamTextMock).toHaveBeenCalledTimes(2)
    expect(response).toBeInstanceOf(Response)
    const text = await response.text()
    expect(text).toContain('temporarily unavailable')
  })
})

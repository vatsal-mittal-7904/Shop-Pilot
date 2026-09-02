import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeWithFallback } from '@/backend/ai/model'

describe('AI Multi-Model Fallback', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('GROQ_API_KEY', 'mock-groq-key')
    vi.stubEnv('GEMINI_API_KEY', 'mock-gemini-key')
  })

  it('succeeds with the primary model when no errors occur', async () => {
    let callCount = 0
    const mockAction = vi.fn().mockImplementation(async (model) => {
      callCount++
      return { success: true, call: callCount }
    })

    const result = await executeWithFallback(mockAction)

    expect(result).toEqual({ success: true, call: 1 })
    expect(mockAction).toHaveBeenCalledTimes(1)
  })

  it('fails over to the secondary model when the primary model throws an error', async () => {
    let callCount = 0
    const mockAction = vi.fn().mockImplementation(async (model) => {
      callCount++
      if (callCount === 1) {
        throw new Error('Primary model rate limited or disconnected')
      }
      return { success: true, modelUsed: 'secondary' }
    })

    const result = await executeWithFallback(mockAction)

    expect(result).toEqual({ success: true, modelUsed: 'secondary' })
    expect(mockAction).toHaveBeenCalledTimes(2)
  })

  it('throws the last error if all configured models fail', async () => {
    const mockAction = vi.fn().mockImplementation(async () => {
      throw new Error('Total provider outage')
    })

    await expect(executeWithFallback(mockAction)).rejects.toThrow('Total provider outage')
    expect(mockAction).toHaveBeenCalledTimes(2)
  })

  it('throws an error if no API keys are configured', async () => {
    vi.stubEnv('GROQ_API_KEY', '')
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '')

    const mockAction = vi.fn()

    await expect(executeWithFallback(mockAction)).rejects.toThrow('No AI models configured')
    expect(mockAction).not.toHaveBeenCalled()
  })
})

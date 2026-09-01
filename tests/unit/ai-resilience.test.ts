import { describe, it, expect, vi, beforeEach } from 'vitest'
import { safeStreamText, safeTool } from '@/backend/utils/aiClient'

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    streamText: vi.fn(),
  }
})

describe('AI Resilience & Graceful Degradation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.GROQ_API_KEY = 'gsk_fakeKey1234567890abcdefghijklmnopqrstuvwx'
  })

  it('throws an error handled by fallback if AI credentials are missing', async () => {
    delete process.env.GROQ_API_KEY
    
    // We expect the fallback behavior to return a valid stream response with the offline text
    const response = await safeStreamText({} as never)
    
    expect(response).toBeInstanceOf(Response)
    const text = await response.text()
    expect(text).toContain('Our AI assistant is temporarily unavailable')
  })

  it('redacts sensitive API keys from tool error details', async () => {
    const maliciousTool = async () => {
      throw new Error(`Failed to auth with GROQ_API_KEY: ${process.env.GROQ_API_KEY}`)
    }

    const wrappedTool = safeTool('malicious_tool', maliciousTool)
    const result = await wrappedTool({}, {})
    
    expect(result).toHaveProperty('error')
    expect(result.error).toContain('An internal error occurred')
    expect(result.details).not.toContain(process.env.GROQ_API_KEY)
    expect(result.details).toContain('[REDACTED_API_KEY]')
  })
})

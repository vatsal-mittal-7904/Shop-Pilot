import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createGroq } from '@ai-sdk/groq'
import { createGoogleGenerativeAI } from '@ai-sdk/google'

export const AI_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant'

export function aiModel() {
  const groq = createGroq({
    apiKey: process.env.GROQ_API_KEY,
  })
  return groq(AI_MODEL)
}

export function googleModel() {
  const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY })
  return google('models/gemini-1.5-flash-latest')
}

/**
 * Multi-Model Fallback Executor
 * 
 * Attempts to execute a Vercel AI SDK function (like generateObject or streamText)
 * across a prioritized chain of model providers. If Groq fails (e.g. rate limit),
 * it seamlessly fails over to Gemini, ensuring the AI is never just "decorative".
 */
export async function executeWithFallback<T>(
  action: (model: any) => Promise<T>
): Promise<T> {
  const models = []
  
  if (process.env.GROQ_API_KEY) {
    models.push(aiModel()) // Fast Groq Llama3
  }
  
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    models.push(googleModel()) // Reliable Gemini 1.5
  }

  if (models.length === 0) {
    throw new Error('No AI models configured. Please set GROQ_API_KEY or GEMINI_API_KEY.')
  }

  let lastError: any
  for (const model of models) {
    try {
      return await action(model)
    } catch (err) {
      console.warn(`[MULTI_MODEL_FALLBACK] Model execution failed, failing over to next provider...`, (err as Error).message)
      lastError = err
    }
  }

  throw lastError
}

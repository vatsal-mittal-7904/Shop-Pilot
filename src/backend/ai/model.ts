import { createGroq } from '@ai-sdk/groq'

export const AI_MODEL = process.env.GROQ_MODEL || 'llama-3.1-70b-versatile'

export function aiModel() {
  const groq = createGroq({
    apiKey: process.env.GROQ_API_KEY,
  })
  return groq(AI_MODEL)
}

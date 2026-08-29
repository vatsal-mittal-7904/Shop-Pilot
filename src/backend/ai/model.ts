import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createGroq } from '@ai-sdk/groq'

export const AI_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b'

export function aiModel() {
  const groq = createGroq({
    apiKey: process.env.GROQ_API_KEY,
  })
  return groq(AI_MODEL)
}

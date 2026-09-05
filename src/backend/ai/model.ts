import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { LanguageModel } from 'ai';

export const AI_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b'

// A global counter to alternate between API keys
let requestCounter = 0;

function hasConfiguredKeys(): boolean {
  return Boolean(
    process.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY_FALLBACK ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GROQ_API_KEY
  );
}

function getLoadBalancedGoogleClient() {
  const keys = [];
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  if (process.env.GEMINI_API_KEY_FALLBACK) keys.push(process.env.GEMINI_API_KEY_FALLBACK);
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) keys.push(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  
  if (keys.length === 0) {
    return createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || 'missing-key' });
  }

  // Round-robin selection
  const selectedKey = keys[requestCounter % keys.length];
  requestCounter++;
  
  return createGoogleGenerativeAI({ apiKey: selectedKey });
}

export function aiModel(): LanguageModel {
  return googleModel()
}

export function googleModel(): LanguageModel {
  const google = getLoadBalancedGoogleClient();
  return google('gemini-3.6-flash') as unknown as LanguageModel;
}

export function googleLiteModel(): LanguageModel {
  const google = getLoadBalancedGoogleClient();
  return google('gemini-3.5-flash-lite') as unknown as LanguageModel;
}

export function groqModel(): LanguageModel {
  const groq = createGroq({ apiKey: process.env.GROQ_API_KEY || 'missing-groq-key' });
  return groq(AI_MODEL) as unknown as LanguageModel;
}

export function getFallbackModelChain(): LanguageModel[] {
  const models: LanguageModel[] = []

  const hasGoogle = Boolean(
    process.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY_FALLBACK ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY
  )
  const hasGroq = Boolean(process.env.GROQ_API_KEY)

  if (hasGoogle) {
    models.push(googleModel())
    models.push(googleLiteModel())
  }
  if (hasGroq) {
    models.push(groqModel())
  }

  // If only one provider is configured, guarantee at least 2 attempts for resilience
  if (models.length === 1) {
    models.push(hasGoogle ? googleLiteModel() : groqModel())
  }

  return models
}

export async function executeWithFallback<T>(
  action: (model: LanguageModel) => Promise<T>
): Promise<T> {
  if (!hasConfiguredKeys()) {
    throw new Error('No AI models configured.')
  }

  const models = getFallbackModelChain()
  if (models.length === 0) {
    throw new Error('No AI models configured.')
  }

  let lastError: Error | unknown;
  for (let i = 0; i < models.length; i++) {
    const model = models[i]
    try {
      return await action(model)
    } catch (err) {
      const nextProvider = i + 1 < models.length ? 'secondary provider' : 'none'
      console.warn(`[MULTI_MODEL_FALLBACK] Model execution failed, failing over... (${(err as Error).message}) -> next: ${nextProvider}`)
      lastError = err
    }
  }

  throw lastError
}


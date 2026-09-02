import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText as originalStreamText,
} from 'ai'

// /api/chat has a 30-second runtime budget. Tool-assisted seller responses
// (catalog search + policy evaluation) often take longer than a bare model
// completion, so a 10-second abort made healthy Groq requests look offline.
// Leave a small buffer for the route to finish serializing its response.
const AI_REQUEST_TIMEOUT_MS = 25_000

function fallbackResponse(message: string) {
  const textId = 'assistant-unavailable'
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: 'text-start', id: textId })
      writer.write({ type: 'text-delta', id: textId, delta: message })
      writer.write({ type: 'text-end', id: textId })
    },
  })

  return createUIMessageStreamResponse({ stream })
}

export async function safeStreamText(params: Parameters<typeof originalStreamText>[0]) {
  const unavailableMessage = 'Our AI assistant is temporarily unavailable. Please try again in a moment, or continue directly with your cart.'

  if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error('AI_STREAM_ERROR: AI credentials missing')
    return fallbackResponse(unavailableMessage)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS)

  try {
    const result = await originalStreamText({
      ...params,
      maxRetries: 2,
      abortSignal: controller.signal,
    })

    // A provider can fail after streamText() has returned. The SDK represents
    // that as an `error` UI chunk, which useChat displays as its generic red
    // error banner. Replace that chunk with a normal assistant message so a
    // transient Groq/network failure does not break the buyer conversation.
    const stream = result.toUIMessageStream({
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error)
        const sanitizedMessage = message.replace(/(gsk_[A-Za-z0-9_-]+)/g, '[REDACTED_API_KEY]')
        console.error('AI_STREAM_ERROR:', sanitizedMessage)
        return unavailableMessage
      },
    }).pipeThrough(new TransformStream({
      transform(chunk, controller) {
        if (chunk.type === 'error') {
          console.error('AI_STREAM_CHUNK_ERROR:', chunk.errorText)
          const textId = 'assistant-unavailable'
          controller.enqueue({ type: 'text-start', id: textId })
          controller.enqueue({ type: 'text-delta', id: textId, delta: unavailableMessage })
          controller.enqueue({ type: 'text-end', id: textId })
          return
        }
        controller.enqueue(chunk)
      },
      flush() {
        clearTimeout(timeout)
      },
    }))

    return createUIMessageStreamResponse({ stream })
  } catch (error) {
    clearTimeout(timeout)
    const message = error instanceof Error ? error.message : String(error)
    const sanitizedMessage = message.replace(/(gsk_[A-Za-z0-9]{20,})/g, '[REDACTED_API_KEY]')
    console.error('AI_STREAM_ERROR:', sanitizedMessage)

    return fallbackResponse(unavailableMessage)
  }
}

export function safeTool<TArgs, TResult>(name: string, fn: (args: TArgs, options: unknown) => Promise<TResult>) {
  return async (args: TArgs, options: unknown): Promise<TResult | { error: string; details?: string }> => {
    try {
      return await fn(args, options)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const sanitized = msg.replace(/(gsk_[A-Za-z0-9]{20,})/g, '[REDACTED_API_KEY]')
      console.error(`TOOL_ERROR [${name}]:`, sanitized)
      return { error: 'An internal error occurred while executing this action.', details: sanitized }
    }
  }
}

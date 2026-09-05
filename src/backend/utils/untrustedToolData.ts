/**
 * Product records are merchant-controlled input, not instructions. Keep the
 * model-facing shape deliberately small and remove text that resembles prompt
 * control syntax. Server-side tools remain the authority for every mutation.
 */
const INSTRUCTION_PATTERN = /(?:ignore|disregard|forget|override|reveal|print|repeat)\s+(?:all\s+)?(?:previous|prior|system|developer|instructions?|prompt)|(?:system|developer|assistant)\s*(?:prompt|message|instructions?)|\b(?:jailbreak|tool[_ -]?call|function[_ -]?call|role\s*:)/i

export function sanitizeUntrustedToolText(value: unknown, maxLength = 120): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
  if (!normalized) return null
  return INSTRUCTION_PATTERN.test(normalized) ? '[untrusted catalog text omitted]' : normalized
}

export function sanitizeCatalogProduct<T extends {
  id: string
  name: string
  category: string
  price: number
  inventory: number
  imageUrl?: string | null
  warrantyYears?: number
  deliveryDays?: number
  tags?: string[]
}>(product: T) {
  const imageUrl = sanitizeImageUrl(product.imageUrl)
  return {
    id: product.id,
    name: sanitizeUntrustedToolText(product.name) ?? 'Unnamed product',
    category: sanitizeUntrustedToolText(product.category, 60) ?? 'Uncategorised',
    price: product.price,
    inventory: product.inventory,
    ...(imageUrl ? { imageUrl } : {}),
    ...(typeof product.warrantyYears === 'number' ? { warrantyYears: product.warrantyYears } : {}),
    ...(typeof product.deliveryDays === 'number' ? { deliveryDays: product.deliveryDays } : {}),
    ...(product.tags ? { tags: product.tags.map((tag) => sanitizeUntrustedToolText(tag, 40)).filter((tag): tag is string => Boolean(tag)) } : {}),
  }
}

function sanitizeImageUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2_000) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

/** Re-sanitise persisted tool results before they become model context. */
export function sanitizeToolMessagesForModel<T>(messages: T[]): T[] {
  return messages.map((message) => {
    if (!message || typeof message !== 'object') return message
    const record = message as Record<string, unknown>
    
    // Sanitize tool result messages
    if (record.role === 'tool') {
      if (Array.isArray(record.content)) {
        const sanitizedContent = record.content.map((p: unknown) => {
          if (!p || typeof p !== 'object') return p;
          const part = p as Record<string, unknown>;
          if (part.type === 'tool-result' && part.result !== undefined) {
            return { ...part, result: sanitizeToolPayload(part.result) };
          }
          return p;
        });
        return { ...record, content: sanitizedContent } as T;
      }
      return message;
    }
    
    // For assistant messages, strip out toolCalls and keep only the text content
    if (record.role === 'assistant') {
      if (Array.isArray(record.content)) {
        const textParts = record.content.filter((p: unknown) => p && typeof p === 'object' && ((p as Record<string, unknown>).type === 'text' || (p as Record<string, unknown>).type === 'tool-call'));
        if (textParts.length === 0) return null;
        return { ...record, content: textParts, toolCalls: undefined } as T;
      }
      if (typeof record.content === 'string') {
        return { ...record, toolCalls: undefined } as T;
      }
    }
    
    return message
  }).filter(Boolean) as T[]
}

function sanitizeToolPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeToolPayload)
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(record)) {
    // Product attributes are an open-ended merchant JSON field. They are useful
    // in the UI but are not necessary for agent reasoning or any authority.
    if (key === 'attributes') continue
    if (typeof entry === 'string') {
      result[key] = sanitizeUntrustedToolText(entry, key === 'imageUrl' ? 2_000 : 240) ?? ''
    } else {
      result[key] = sanitizeToolPayload(entry)
    }
  }
  return result
}

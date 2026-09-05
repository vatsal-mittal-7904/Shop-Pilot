import { prisma } from '@/backend/db/prisma'

const GENERIC_COMMERCE_INTENT_PATTERN = /\b(?:buy|purchase|looking\s+for|search|find|recommend|need|show|browse|price|cost|budget|under|below|around|cheapest|premium|₹|rupees?|rs\.?|inr|keyboard|mouse|headphones?|monitor|webcam|accessor(?:y|ies))\b/i

export async function shouldTriggerCatalogSearch(
  merchantId: string,
  message: string,
  capturedIntent?: { category?: string[]; maximumAmount?: number | null } | null
): Promise<boolean> {
  if (!message || typeof message !== 'string') return false

  // 1. Direct intent detection: if structured intent extracted categories or budget, trigger search
  if (capturedIntent && ((capturedIntent.category && capturedIntent.category.length > 0) || capturedIntent.maximumAmount != null)) {
    return true
  }

  // 2. Generic commerce verbs, price markers, or currency signals
  if (GENERIC_COMMERCE_INTENT_PATTERN.test(message)) {
    return true
  }

  // 3. Dynamic Merchant Taxonomy Matching: check against merchant's actual product categories, tags, and product names
  try {
    const products = await prisma.product.findMany({
      where: { merchantId, inventory: { gt: 0 } },
      select: { category: true, tags: true, name: true },
      take: 60,
    })

    const lowerMessage = message.toLowerCase()
    for (const p of products) {
      if (p.category && lowerMessage.includes(p.category.toLowerCase())) return true
      if (p.name && lowerMessage.includes(p.name.toLowerCase())) return true
      if (p.tags && Array.isArray(p.tags) && p.tags.some((tag: string) => lowerMessage.includes(tag.toLowerCase()))) return true
    }
  } catch (err) {
    console.warn('[DYNAMIC_TAXONOMY:WARNING] Failed to query merchant categories:', err)
  }

  return false
}

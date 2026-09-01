import { createHmac, timingSafeEqual } from 'node:crypto'

type BindingItem = { productId: string; quantity: number; unitPrice: number }

/**
 * Creates an HMAC over the exact customer-owned cart selection. Product IDs
 * from an LLM are never accepted on the offer path; this binding is created
 * only from rows added through the shopper's authenticated basket action.
 */
export function cartSelectionBinding(input: {
  customerId: string
  merchantId: string
  cartId: string
  items: Array<BindingItem>
}) {
  const secret = process.env.OFFER_BINDING_SECRET || process.env.RAZORPAY_KEY_SECRET
  if (!secret) throw new Error('OFFER_BINDING_SECRET must be configured before checkout offers can be created.')

  // The sort must be a TOTAL order, otherwise the canonical string is not
  // deterministic and a valid offer can fail its own binding check. Sorting on
  // productId alone left ties unresolved for line sets that repeat a product
  // (recommendation pricing can emit those), and Array#sort is not required to
  // be stable across engines for the comparator returning 0.
  const canonicalItems = [...input.items]
    .sort(
      (left, right) =>
        left.productId.localeCompare(right.productId) ||
        left.quantity - right.quantity ||
        left.unitPrice - right.unitPrice,
    )
    .map((item) => `${item.productId}:${item.quantity}:${item.unitPrice}`)
    .join('|')
  return createHmac('sha256', secret)
    .update(`${input.customerId}|${input.merchantId}|${input.cartId}|${canonicalItems}`)
    .digest('hex')
}

/**
 * Constant-time comparison for two bindings. A plain `!==` on a hex digest
 * leaks how many leading characters matched through its timing, which is
 * exactly the signal an attacker forging a binding would want.
 */
export function bindingsMatch(expected: string, actual: string) {
  const expectedBytes = Buffer.from(expected, 'utf8')
  const actualBytes = Buffer.from(actual, 'utf8')
  // timingSafeEqual throws on length mismatch, which would itself be a
  // (coarser) side channel, so length is checked first and explicitly.
  if (expectedBytes.length !== actualBytes.length) return false
  return timingSafeEqual(expectedBytes, actualBytes)
}

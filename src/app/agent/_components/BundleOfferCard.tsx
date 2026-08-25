'use client'

import { useState } from 'react'
// acceptBundle lives in offer.ts alongside the other offer-creation actions.
import { acceptBundle } from '@/backend/actions/offer'

type BundleOfferCardProps = {
  cartId: string
  addonProductId: string
  addon: {
    name: string
    price: number // paise
    imageUrl?: string | null
    category?: string
  }
  pairedWith: string
  discountPercent: number
  bundleSubtotal: number // paise
  bundleDiscount: number // paise
  bundleTotal: number // paise
  /** Optional: notify a parent list/renderer that this card was dismissed. */
  onDismiss?: () => void
}

const currencyFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
function formatInr(paise: number) {
  return currencyFormatter.format(paise / 100)
}

type CardState = 'idle' | 'loading' | 'success' | 'error' | 'dismissed'

export function BundleOfferCard({
  cartId,
  addonProductId,
  addon,
  pairedWith,
  discountPercent,
  bundleSubtotal,
  bundleDiscount,
  bundleTotal,
  onDismiss,
}: BundleOfferCardProps) {
  const [state, setState] = useState<CardState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleAccept() {
    setState('loading')
    setErrorMessage(null)
    try {
      await acceptBundle(cartId, addonProductId, discountPercent)
      setState('success')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not add this bundle')
      setState('error')
    }
  }

  // Reject is a pure client-side dismissal -- no server call, no Offer
  // mutation. The chat continues normally; the loop guard that stops this
  // same addon being re-pitched lives server-side in route.ts, scanning
  // conversation history, not here.
  function handleReject() {
    onDismiss?.()
    setState('dismissed')
  }

  if (state === 'dismissed') return null

  return (
    <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="flex gap-3 p-3">
        <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-100">
          {addon.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={addon.imageUrl} alt={addon.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-neutral-400">No image</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">Bundle with your {pairedWith}</p>
          <h3 className="truncate text-sm font-medium text-neutral-900">{addon.name}</h3>
          <p className="mt-0.5 text-xs text-neutral-500">{formatInr(addon.price)} add-on &middot; {discountPercent}% bundle discount</p>
        </div>
      </div>

      <div className="border-t border-neutral-100 px-3 py-2">
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>Bundle subtotal</span>
          <span>{formatInr(bundleSubtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-green-600">
          <span>Bundle discount ({discountPercent}%)</span>
          <span>-{formatInr(bundleDiscount)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-sm font-semibold text-neutral-900">
          <span>New total</span>
          <span>{formatInr(bundleTotal)}</span>
        </div>
      </div>

      <div className="border-t border-neutral-100 p-3">
        {state === 'success' ? (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-center text-sm font-medium text-green-700">
            Bundle added -- new total {formatInr(bundleTotal)}
          </p>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleReject}
              disabled={state === 'loading'}
              className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
            >
              No thanks
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={state === 'loading'}
              className="flex-1 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60"
            >
              {state === 'loading' ? 'Adding…' : state === 'error' ? 'Try again' : 'Add bundle'}
            </button>
          </div>
        )}
        {state === 'error' && errorMessage && (
          <p className="mt-2 text-center text-xs text-red-600">{errorMessage}</p>
        )}
      </div>
    </div>
  )
}

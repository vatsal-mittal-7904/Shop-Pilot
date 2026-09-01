'use client'

import { useState } from 'react'
import { acceptRecommendation, declineRecommendation } from '@/backend/actions/offer'
import { startCheckout } from '@/backend/actions/payment'
import { acceptOfferForCheckout } from '@/backend/actions/order'
import { CheckoutButton } from './CheckoutButton'

type UpsellOfferCardProps = {
  recommendationId: string
  cartId: string
  upgradeProductId: string
  upgrade: {
    name: string
    price: number // paise
    imageUrl?: string | null
    category?: string
  }
  replaces: string
  discountPercent: number
  upsellSubtotal: number // paise
  upsellDiscount: number // paise
  upsellTotal: number // paise
  onDismiss?: () => void
}

const currencyFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
function formatInr(paise: number) {
  return currencyFormatter.format(paise / 100)
}

type CardState = 'idle' | 'loading' | 'success' | 'error' | 'dismissed'

export function UpsellOfferCard({
  recommendationId,
  cartId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  upgradeProductId: _upgradeProductId,
  upgrade,
  replaces,
  discountPercent,
  upsellSubtotal,
  upsellDiscount,
  upsellTotal,
  onDismiss,
}: UpsellOfferCardProps) {
  const [state, setState] = useState<CardState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [checkoutData, setCheckoutData] = useState<{ internalOrderId: string, razorpayOrderId: string, amount: number, currency: string } | null>(null)
  const [finalTotal, setFinalTotal] = useState<number | null>(null)
  const [finalDiscount, setFinalDiscount] = useState<number | null>(null)

  async function handleAccept() {
    setState('loading')
    setErrorMessage(null)
    try {
      const offer = await acceptRecommendation(recommendationId, cartId)
      await acceptOfferForCheckout(offer.id)
      const checkout = await startCheckout(offer.id)
      setCheckoutData({
        internalOrderId: checkout.internalOrderId,
        razorpayOrderId: checkout.razorpayOrder.id,
        amount: checkout.razorpayOrder.amount,
        currency: checkout.razorpayOrder.currency
      })
      setFinalTotal(offer.total)
      setFinalDiscount(offer.discount)
      setState('success')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not accept this upgrade')
      setState('error')
    }
  }

  async function handleReject() {
    setState('loading')
    try {
      await declineRecommendation(recommendationId)
      onDismiss?.()
      setState('dismissed')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not decline')
      setState('idle')
    }
  }

  if (state === 'dismissed') return null

  return (
    <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="flex gap-3 p-3">
        <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-100">
          {upgrade.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={upgrade.imageUrl} alt={upgrade.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-neutral-400">No image</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-indigo-500 font-bold">Upgrade your {replaces}</p>
          <h3 className="truncate text-sm font-medium text-neutral-900">{upgrade.name}</h3>
          <p className="mt-0.5 text-xs text-neutral-500">{formatInr(upgrade.price)} &middot; {discountPercent}% discount</p>
        </div>
      </div>

      <div className="border-t border-neutral-100 px-3 py-2">
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>Order subtotal after replacement</span>
          <span>{formatInr(upsellSubtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-green-600">
          <span>Upgrade discount ({discountPercent}%)</span>
          <span>-{formatInr(finalDiscount ?? upsellDiscount)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-sm font-semibold text-neutral-900">
          <span>Order total after upgrade</span>
          <span>{formatInr(finalTotal ?? upsellTotal)}</span>
        </div>
      </div>

      <div className="border-t border-neutral-100 p-3">
        {state === 'success' && checkoutData ? (
          <div className="space-y-3">
            <p className="rounded-lg bg-green-50 px-3 py-2 text-center text-sm font-medium text-green-700">
              Upgrade accepted -- new total {formatInr(finalTotal ?? upsellTotal)}
            </p>
            <CheckoutButton
              orderId={checkoutData.internalOrderId}
              razorpayOrderId={checkoutData.razorpayOrderId}
              amount={checkoutData.amount}
              currency={checkoutData.currency}
            />
          </div>
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
              className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 shadow-sm"
            >
              {state === 'loading' ? 'Upgrading…' : state === 'error' ? 'Try again' : 'Upgrade item'}
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

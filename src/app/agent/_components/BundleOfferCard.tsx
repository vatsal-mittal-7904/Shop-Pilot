'use client'
import Image from 'next/image';

import { useState } from 'react'
// acceptRecommendation lives in offer.ts alongside the other offer-creation actions.
import { acceptRecommendation, declineRecommendation } from '@/backend/actions/offer'

import { startCheckout } from '@/backend/actions/payment'
import { acceptOfferForCheckout } from '@/backend/actions/order'
import { CheckoutButton } from './CheckoutButton'

type BundleOfferCardProps = {
  recommendationId: string
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
  recommendationId,
  cartId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addonProductId: _addonProductId,
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
  const [checkoutData, setCheckoutData] = useState<{ internalOrderId: string, razorpayOrderId: string, amount: number, currency: string } | null>(null)
  const [finalTotal, setFinalTotal] = useState<number | null>(null)
  const [finalDiscount, setFinalDiscount] = useState<number | null>(null)

  const priorCartSubtotal = Math.max(0, bundleSubtotal - addon.price)
  const currentDiscount = finalDiscount ?? bundleDiscount
  const discountedAddonPrice = Math.max(0, addon.price - currentDiscount)
  const displayTotal = finalTotal ?? bundleTotal

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
      setErrorMessage(error instanceof Error ? error.message : 'Could not add this bundle')
      setState('error')
    }
  }

  async function handleReject() {
    setState('loading')
    setErrorMessage(null)
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
    <div className="w-full max-w-sm rounded-xl border border-neutral-200 dark:border-[#2b3a5e] bg-white dark:bg-[#151f38] shadow-sm overflow-hidden">
      <div className="flex gap-3 p-3">
        <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-slate-800">
          {addon.imageUrl ? (
             
            <Image src={addon.imageUrl} alt={addon.name} fill unoptimized className="object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-neutral-400">No image</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-neutral-400 dark:text-slate-400">Bundle with your {pairedWith}</p>
          <h3 className="truncate text-sm font-medium text-neutral-900 dark:text-white">{addon.name}</h3>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-slate-300">
            <span className="line-through text-neutral-400 mr-1">{formatInr(addon.price)}</span>
            <span className="font-semibold text-green-600 dark:text-emerald-400">{formatInr(discountedAddonPrice)}</span>
            <span className="ml-1 text-[11px] text-neutral-400 dark:text-slate-400">({discountPercent}% bundle discount)</span>
          </p>
        </div>
      </div>

      <div className="border-t border-neutral-100 dark:border-[#2b3a5e] px-3 py-2 space-y-1">
        {priorCartSubtotal > 0 && (
          <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-slate-400">
            <span>Current basket subtotal</span>
            <span>{formatInr(priorCartSubtotal)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-slate-400">
          <span>Add-on ({addon.name})</span>
          <span>+{formatInr(addon.price)}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-green-600 dark:text-emerald-400">
          <span>Bundle discount ({discountPercent}%)</span>
          <span>-{formatInr(currentDiscount)}</span>
        </div>
        <div className="pt-1.5 border-t border-neutral-100 dark:border-[#2b3a5e] flex items-center justify-between text-sm font-semibold text-neutral-900 dark:text-white">
          <span>New basket total</span>
          <span>{formatInr(displayTotal)}</span>
        </div>
      </div>

      <div className="border-t border-neutral-100 dark:border-[#2b3a5e] p-3">
        {state === 'success' && checkoutData ? (
          <div className="space-y-3">
            <p className="rounded-lg bg-green-50 dark:bg-emerald-950/40 border border-emerald-500/20 px-3 py-2 text-center text-sm font-medium text-green-700 dark:text-emerald-300">
              Bundle added -- new total {formatInr(displayTotal)}
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
              className="flex-1 rounded-lg border border-neutral-200 dark:border-[#2b3a5e] px-3 py-2 text-sm font-medium text-neutral-600 dark:text-slate-300 hover:bg-neutral-50 dark:hover:bg-[#1a2644] disabled:opacity-50 transition-colors"
            >
              No thanks
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={state === 'loading'}
              className="flex-1 rounded-lg bg-neutral-900 dark:bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {state === 'loading' ? 'Adding…' : state === 'error' ? 'Try again' : 'Add bundle'}
            </button>
          </div>
        )}
        {state === 'error' && errorMessage && (
          <p className="mt-2 text-center text-xs text-red-600 dark:text-red-400">{errorMessage}</p>
        )}
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { startCheckout } from '@/backend/actions/payment'
import { acceptOfferForCheckout } from '@/backend/actions/order'
import { CheckoutButton } from './CheckoutButton'

type OfferCheckoutControlProps = {
  offerId: string
  label: string
  className: string
  merchantName?: string
}

/**
 * The only bridge from a persisted offer to the shared Razorpay checkout UI.
 * It records explicit acceptance and creates the provider order server-side,
 * then delegates all browser payment handling to CheckoutButton. Keeping this
 * path singular prevents one offer type from treating the browser callback as
 * payment truth while another waits for the signed webhook.
 */
export function OfferCheckoutControl({ offerId, label, className, merchantName }: OfferCheckoutControlProps) {
  const [state, setState] = useState<'idle' | 'preparing' | 'ready' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [checkout, setCheckout] = useState<{
    internalOrderId: string
    razorpayOrderId: string
    amount: number
    currency: string
  } | null>(null)

  async function prepareCheckout() {
    setState('preparing')
    setErrorMessage(null)
    try {
      await acceptOfferForCheckout(offerId)
      const result = await startCheckout(offerId)
      setCheckout({
        internalOrderId: result.internalOrderId,
        razorpayOrderId: result.razorpayOrder.id,
        amount: result.razorpayOrder.amount,
        currency: result.razorpayOrder.currency,
      })
      setState('ready')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Checkout could not be prepared.')
      setState('error')
    }
  }

  if (checkout) {
    return (
      <CheckoutButton
        orderId={checkout.internalOrderId}
        razorpayOrderId={checkout.razorpayOrderId}
        amount={checkout.amount}
        currency={checkout.currency}
        merchantName={merchantName}
      />
    )
  }

  return (
    <div className="w-full">
      <button type="button" onClick={prepareCheckout} disabled={state === 'preparing'} className={className}>
        {state === 'preparing' ? 'Preparing secure checkout…' : state === 'error' ? 'Try again' : label}
      </button>
      {errorMessage && <p className="mt-2 text-center text-xs text-red-600">{errorMessage}</p>}
    </div>
  )
}

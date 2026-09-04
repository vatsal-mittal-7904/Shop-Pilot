'use client'

import { useEffect, useRef, useState } from 'react'
// Logs a client-side "payment submitted" audit event only. It must never set
// Order.status to PAID -- that happens exclusively in the signature-verified
// webhook at src/app/api/webhooks/razorpay/route.ts, which is also where the
// inventory decrement happens.
import { confirmPaymentPending, getCustomerOrderStatus } from '@/backend/actions/payment'

type CheckoutButtonProps = {
  // `orderId` is our *internal* Order id, distinct from Razorpay's, because
  // confirmPaymentPending(orderId) needs our own id. The generate_checkout_link
  // tool returns it alongside razorpayOrderId/amount for exactly this reason.
  orderId: string
  razorpayOrderId: string
  amount: number // paise
  currency?: string
  merchantName?: string
}

type CheckoutState = 'idle' | 'opening' | 'submitted' | 'paid' | 'failed'

type RazorpayHandlerResponse = {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

type RazorpayOptions = {
  key: string
  amount: number
  currency: string
  order_id: string
  name: string
  handler: (response: RazorpayHandlerResponse) => void
  modal?: { ondismiss?: () => void }
  theme?: { color?: string }
}

type RazorpayInstance = {
  open: () => void
  on: (event: 'payment.failed', handler: (response: unknown) => void) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance
  }
}

const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

let scriptLoadPromise: Promise<void> | null = null
function loadRazorpayScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve()
  if (scriptLoadPromise) return scriptLoadPromise

  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = RAZORPAY_SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptLoadPromise = null // allow retry on next click
      reject(new Error('Could not load the Razorpay checkout script'))
    }
    document.body.appendChild(script)
  })
  return scriptLoadPromise
}

const currencyFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
function formatInr(paise: number) {
  return currencyFormatter.format(paise / 100)
}

export function CheckoutButton({ orderId, razorpayOrderId, amount, currency = 'INR', merchantName = 'TechNest' }: CheckoutButtonProps) {
  const [state, setState] = useState<CheckoutState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [verificationMessage, setVerificationMessage] = useState('Waiting for Razorpay’s signed payment confirmation…')
  const cancelled = useRef(false)

  useEffect(() => {
    // Reset in setup as React development Strict Mode intentionally runs an
    // effect setup/cleanup cycle before the component is used for real.
    cancelled.current = false
    return () => { cancelled.current = true }
  }, [])

  async function verifyPayment() {
    // The checkout callback is only a browser signal. Poll a customer-scoped
    // read model until the signature-verified webhook settles the order.
    for (let attempt = 0; attempt < 15 && !cancelled.current; attempt += 1) {
      try {
        const order = await getCustomerOrderStatus(orderId)
        if (order.status === 'PAID') {
          setState('paid')
          setVerificationMessage(`Verified payment${order.razorpayPaymentId ? ` (${order.razorpayPaymentId})` : ''}. We will send the delivery details to your registered email address once the merchant has accepted and processed your order.`)
          return
        }
        if (order.status === 'PAYMENT_FAILED' || order.status === 'INVENTORY_FAILED') {
          setState('failed')
          setErrorMessage(order.status === 'INVENTORY_FAILED'
            ? 'Stock changed before fulfillment. If payment was captured, a refund is being processed.'
            : 'Razorpay reported that this payment failed. You have not been charged.')
          return
        }
      } catch {
        // A transient status-read failure is not a payment failure.
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    if (!cancelled.current) {
      setVerificationMessage('Payment is still awaiting signed confirmation. Keep this order open and do not pay again.')
    }
  }

  async function handlePay() {
    setState('opening')
    setErrorMessage(null)
    try {
      await loadRazorpayScript()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not open checkout')
      setState('failed')
      return
    }

    const key = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
    if (!key) {
      setErrorMessage('Checkout is not configured (missing publishable key)')
      setState('failed')
      return
    }
    if (!window.Razorpay) {
      setErrorMessage('Checkout script did not initialize')
      setState('failed')
      return
    }

    const rzp = new window.Razorpay({
      key,
      amount,
      currency,
      order_id: razorpayOrderId,
      name: merchantName,
      // CRITICAL: this handler fires on the client the instant Razorpay's
      // modal reports success. It must NEVER set Order.status = PAID itself
      // -- that would mean trusting an unverified client-side signal for a
      // real money event. confirmPaymentPending only writes a "payment
      // submitted from the client" audit log entry; the authoritative PAID
      // transition happens exclusively in the server-side webhook handler,
      // which verifies Razorpay's signature before touching Order.status.
      handler: () => {
        setState('submitted')
        void confirmPaymentPending(orderId).catch(() => {
          // Best-effort audit log only -- if this call fails, the payment
          // itself is unaffected (the webhook is still the source of truth),
          // so there is nothing to roll back or retry here.
        })
        void verifyPayment()
      },
      modal: {
        ondismiss: () => {
          // User closed the modal without completing payment -- let them retry.
          setState((current) => (current === 'submitted' ? current : 'idle'))
        },
      },
      theme: { color: '#171717' },
    })

    rzp.on('payment.failed', () => {
      setErrorMessage('Payment failed. You have not been charged.')
      setState('failed')
    })

    rzp.open()
  }

  if (state === 'submitted') {
    return (
      <div className="w-full max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center">
        <p className="text-sm font-medium text-amber-800">Payment submitted</p>
        <p className="mt-1 text-xs text-amber-700">
          {verificationMessage}
        </p>
      </div>
    )
  }

  if (state === 'paid') {
    return (
      <div className="w-full max-w-sm rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center">
        <p className="text-sm font-semibold text-emerald-800">Payment verified</p>
        <p className="mt-1 text-xs text-emerald-700">{verificationMessage}</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <button
        type="button"
        onClick={handlePay}
        disabled={state === 'opening'}
        className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60"
      >
        {state === 'opening' ? 'Opening secure checkout…' : state === 'failed' ? 'Try payment again' : `Pay ${formatInr(amount)}`}
      </button>
      {state === 'failed' && errorMessage && (
        <p className="mt-2 text-center text-xs text-red-600">{errorMessage}</p>
      )}
    </div>
  )
}

'use client'
import Image from 'next/image';

import { useEffect, useRef, useState } from 'react'
import { addToCart } from '@/backend/actions/cart'

// Shape returned by the `search_catalog` tool result (a subset of the
// Product model). Only the fields the card actually renders are required.
export type ProductCardData = {
  id: string
  name: string
  category: string
  price: number // stored in paise
  imageUrl?: string | null
  inventory: number
  warrantyYears?: number
  deliveryDays?: number
  tags?: string[]
}

type SelectState = 'idle' | 'loading' | 'success' | 'error'

interface ProductCardsProps {
  products: ProductCardData[]
  customerId: string
  merchantId: string
  onSelect?: (product: ProductCardData) => void
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

function formatInr(paise: number) {
  return inrFormatter.format(paise / 100)
}

function getBadges(product: ProductCardData): string[] {
  const badges: string[] = [product.category]

  if (product.warrantyYears && product.warrantyYears > 0) {
    badges.push(`${product.warrantyYears} yr warranty`)
  }
  if (typeof product.deliveryDays === 'number') {
    badges.push(product.deliveryDays <= 0 ? 'Same-day delivery' : `${product.deliveryDays}-day delivery`)
  }
  if (badges.length < 3 && product.tags?.length) {
    for (const tag of product.tags) {
      if (badges.length >= 3) break
      if (!badges.includes(tag)) badges.push(tag)
    }
  }
  return badges.slice(0, 3)
}

export function ProductCards({ products, customerId, merchantId, onSelect }: ProductCardsProps) {
  const [status, setStatus] = useState<Record<string, SelectState>>({})
  const [errorMessage, setErrorMessage] = useState<Record<string, string>>({})
  const resetTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    const timers = resetTimers.current
    return () => {
      Object.values(timers).forEach(clearTimeout)
    }
  }, [])

  if (!products.length) return null

  async function handleSelect(productId: string) {
    if (resetTimers.current[productId]) {
      clearTimeout(resetTimers.current[productId])
      delete resetTimers.current[productId]
    }
    setStatus((prev) => ({ ...prev, [productId]: 'loading' }))
    setErrorMessage((prev) => {
      const next = { ...prev }
      delete next[productId]
      return next
    })

    try {
      await addToCart(customerId, merchantId, productId)
      setStatus((prev) => ({ ...prev, [productId]: 'success' }))
      if (onSelect) {
        const product = products.find((p) => p.id === productId)
        if (product) onSelect(product)
      }
      // Revert to idle after a moment so the shopper can add another unit.
      resetTimers.current[productId] = setTimeout(() => {
        setStatus((prev) => ({ ...prev, [productId]: 'idle' }))
      }, 1800)
    } catch (error) {
      setStatus((prev) => ({ ...prev, [productId]: 'error' }))
      setErrorMessage((prev) => ({
        ...prev,
        [productId]: error instanceof Error ? error.message : 'Could not add to cart',
      }))
    }
  }

  const groupedProducts = products.reduce((acc, product) => {
    const cat = product.category || 'Other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(product)
    return acc
  }, {} as Record<string, ProductCardData[]>)

  return (
    <div className="flex flex-col gap-6">
      {Object.entries(groupedProducts).map(([category, catProducts]) => (
        <div key={category} className="flex flex-col gap-2">
          <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{category}</h4>
          <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
            {catProducts.map((product) => {
              const state = status[product.id] ?? 'idle'
              const outOfStock = product.inventory < 1
              const badges = getBadges(product)

              return (
                <div
                  key={product.id}
                  className="flex w-64 flex-shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
                >
                  <div className="relative h-40 w-full bg-gray-100">
                    {product.imageUrl ? (
                       
                      <Image src={product.imageUrl} alt={product.name} fill unoptimized className="object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
                        No image
                      </div>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <h3 className="line-clamp-2 text-sm font-semibold text-gray-900">{product.name}</h3>
                    <p className="text-base font-bold text-gray-900">{formatInr(product.price)}</p>

                    <div className="flex flex-wrap gap-1">
                      {badges.map((badge) => (
                        <span
                          key={badge}
                          className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
                        >
                          {badge}
                        </span>
                      ))}
                      {outOfStock && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                          Out of stock
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={outOfStock || state === 'loading'}
                      onClick={() => handleSelect(product.id)}
                      className={[
                        'mt-auto w-full rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                        state === 'success'
                          ? 'bg-green-600 text-white'
                          : state === 'error'
                            ? 'bg-red-600 text-white'
                            : 'bg-gray-900 text-white disabled:cursor-not-allowed disabled:bg-gray-300',
                      ].join(' ')}
                    >
                      {outOfStock
                        ? 'Out of stock'
                        : state === 'loading'
                          ? 'Adding…'
                          : state === 'success'
                            ? 'Added to cart'
                            : state === 'error'
                              ? 'Try again'
                              : 'Select'}
                    </button>

                    {state === 'error' && errorMessage[product.id] && (
                      <p className="text-xs text-red-600">{errorMessage[product.id]}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

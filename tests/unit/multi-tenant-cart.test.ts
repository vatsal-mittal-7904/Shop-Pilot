import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCartUpdateMany = vi.fn()
const mockExecuteRaw = vi.fn()
const mockProductFindUnique = vi.fn()
const mockCartFindFirst = vi.fn()
const mockCartCreate = vi.fn()
const mockCartUpdate = vi.fn()
const mockCartItemFindUnique = vi.fn()
const mockCartItemUpdate = vi.fn()
const mockCartItemCreate = vi.fn()
const mockCartFindUniqueOrThrow = vi.fn()

const mockTransaction = vi.fn().mockImplementation(async (callback) => {
  const tx = {
    $executeRaw: mockExecuteRaw,
    product: { findUnique: mockProductFindUnique },
    cart: { 
      updateMany: mockCartUpdateMany,
      findFirst: mockCartFindFirst,
      create: mockCartCreate,
      update: mockCartUpdate,
      findUniqueOrThrow: mockCartFindUniqueOrThrow
    },
    cartItem: {
      findUnique: mockCartItemFindUnique,
      update: mockCartItemUpdate,
      create: mockCartItemCreate,
    }
  }
  return await callback(tx)
})

vi.mock('@/backend/auth/session', () => ({
  requireCustomer: vi.fn().mockResolvedValue({ 
    user: { id: 'user-1' }, 
    customer: { id: '11111111-1111-4111-8111-111111111111' } 
  })
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    product: { findUnique: (...args) => mockProductFindUnique(...args) },
    $transaction: (...args) => mockTransaction(...args)
  }
}))

import { addToCart } from '@/backend/actions/cart'

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111'
const MERCHANT_B = '22222222-2222-4222-8222-222222222222'
const PRODUCT_B = '33333333-3333-4333-8333-333333333333'

describe('Multi-Tenant Cart Sweeping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    mockProductFindUnique.mockResolvedValue({
      id: PRODUCT_B,
      merchantId: MERCHANT_B,
      inventory: 10
    })

    mockCartFindFirst.mockResolvedValue(null)
    mockCartCreate.mockResolvedValue({ id: 'cart-b-new', customerId: CUSTOMER_ID, merchantId: MERCHANT_B })
    
    mockCartItemFindUnique.mockResolvedValue(null)
    mockCartItemCreate.mockResolvedValue({ id: 'item-1', cartId: 'cart-b-new', productId: PRODUCT_B, quantity: 1 })
    
    mockCartFindUniqueOrThrow.mockResolvedValue({
      id: 'cart-b-new',
      items: [{ productId: PRODUCT_B, quantity: 1 }]
    })
  })

  it('automatically sweeps ACTIVE carts from other merchants when engaging with a new merchant', async () => {
    await addToCart(CUSTOMER_ID, MERCHANT_B, PRODUCT_B)

    expect(mockCartUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockCartUpdateMany).toHaveBeenCalledWith({
      where: {
        customerId: CUSTOMER_ID,
        merchantId: { not: MERCHANT_B },
        status: 'ACTIVE',
      },
      data: { status: 'ABANDONED' }
    })
  })
})

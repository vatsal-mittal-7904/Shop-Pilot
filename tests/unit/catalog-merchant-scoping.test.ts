import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireCustomer: vi.fn(),
  checkRateLimit: vi.fn(),
  checkDistributedRateLimit: vi.fn(),
  merchantFindMany: vi.fn(),
  merchantFindUnique: vi.fn(),
  productFindMany: vi.fn(),
}))

vi.mock('@/backend/auth/session', () => ({
  requireCustomer: mocks.requireCustomer,
}))

vi.mock('@/backend/utils/rateLimit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  checkDistributedRateLimit: mocks.checkDistributedRateLimit,
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    merchant: {
      findMany: mocks.merchantFindMany,
      findUnique: mocks.merchantFindUnique,
    },
    product: {
      findMany: mocks.productFindMany,
    },
  },
}))

import { GET as getCatalog } from '@/app/api/agent/catalog/route'
import { POST as searchCatalog } from '@/app/api/agent/search/route'

const MERCHANT_1 = '11111111-1111-4111-8111-111111111111'
const MERCHANT_2 = '22222222-2222-4222-8222-222222222222'

describe('Catalog & Search Multi-Merchant Scoping', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireCustomer.mockResolvedValue({ customer: { id: 'cust-1' } })
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 })
    mocks.checkDistributedRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0 })
  })

  describe('GET /api/agent/catalog', () => {
    test('returns only products belonging to the requested merchant when merchantId is provided', async () => {
      mocks.merchantFindUnique.mockResolvedValue({ id: MERCHANT_2, name: 'Store 2' })
      mocks.productFindMany.mockResolvedValue([
        { id: 'p2', name: 'Product 2', merchantId: MERCHANT_2, inventory: 5 },
      ])

      const req = new Request(`http://localhost:3000/api/agent/catalog?merchantId=${MERCHANT_2}`)
      const res = await getCatalog(req)

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.merchant).toEqual({ id: MERCHANT_2, name: 'Store 2' })
      expect(data.products).toHaveLength(1)
      expect(mocks.productFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { merchantId: MERCHANT_2, inventory: { gt: 0 } },
      }))
    })

    test('supports x-merchant-id header for scoping catalog', async () => {
      mocks.merchantFindUnique.mockResolvedValue({ id: MERCHANT_1, name: 'Store 1' })
      mocks.productFindMany.mockResolvedValue([])

      const req = new Request('http://localhost:3000/api/agent/catalog', {
        headers: { 'x-merchant-id': MERCHANT_1 },
      })
      const res = await getCatalog(req)

      expect(res.status).toBe(200)
      expect(mocks.merchantFindUnique).toHaveBeenCalledWith({ where: { id: MERCHANT_1 } })
    })

    test('rejects request with 400 when invalid merchant UUID is provided', async () => {
      const req = new Request('http://localhost:3000/api/agent/catalog?merchantId=invalid-uuid')
      const res = await getCatalog(req)

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: 'Invalid merchant ID format' })
    })

    test('returns 404 when requested merchant is not found', async () => {
      mocks.merchantFindUnique.mockResolvedValue(null)

      const req = new Request(`http://localhost:3000/api/agent/catalog?merchantId=${MERCHANT_1}`)
      const res = await getCatalog(req)

      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toEqual({ error: 'Merchant unavailable' })
    })

    test('rejects request with 400 when multiple merchants exist and no merchantId is provided', async () => {
      mocks.merchantFindMany.mockResolvedValue([{ id: MERCHANT_1 }, { id: MERCHANT_2 }])

      const req = new Request('http://localhost:3000/api/agent/catalog')
      const res = await getCatalog(req)

      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('Merchant context is required when multiple merchants exist')
    })

    test('gracefully resolves single merchant when only 1 merchant exists in system', async () => {
      mocks.merchantFindMany.mockResolvedValue([{ id: MERCHANT_1 }])
      mocks.merchantFindUnique.mockResolvedValue({ id: MERCHANT_1, name: 'TechNest' })
      mocks.productFindMany.mockResolvedValue([])

      const req = new Request('http://localhost:3000/api/agent/catalog')
      const res = await getCatalog(req)

      expect(res.status).toBe(200)
      expect(mocks.merchantFindUnique).toHaveBeenCalledWith({ where: { id: MERCHANT_1 } })
    })
  })

  describe('POST /api/agent/search', () => {
    test('returns only search results belonging to the requested merchant', async () => {
      mocks.merchantFindUnique.mockResolvedValue({ id: MERCHANT_2, name: 'Store 2' })
      mocks.productFindMany.mockResolvedValue([
        { id: 'p-search', name: 'Cable', merchantId: MERCHANT_2, inventory: 10 },
      ])

      const req = new Request('http://localhost:3000/api/agent/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'cable', merchantId: MERCHANT_2 }),
      })
      const res = await searchCatalog(req)

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.merchant).toEqual({ id: MERCHANT_2, name: 'Store 2' })
      expect(mocks.productFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ merchantId: MERCHANT_2, inventory: { gt: 0 } }),
      }))
    })

    test('rejects search with 400 when multiple merchants exist and no merchantId is provided', async () => {
      mocks.merchantFindMany.mockResolvedValue([{ id: MERCHANT_1 }, { id: MERCHANT_2 }])

      const req = new Request('http://localhost:3000/api/agent/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'cable' }),
      })
      const res = await searchCatalog(req)

      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('Merchant context is required when multiple merchants exist')
    })
  })
})

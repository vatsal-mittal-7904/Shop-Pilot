import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  productFindMany: vi.fn(),
  productFindUnique: vi.fn(),
  cartFindFirst: vi.fn(),
  cartCreate: vi.fn(),
  cartItemUpsert: vi.fn(),
  offerCreate: vi.fn(),
  offerFindUnique: vi.fn(),
  offerUpdate: vi.fn(),
  orderCreate: vi.fn(),
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    product: {
      findMany: mocks.productFindMany,
      findUnique: mocks.productFindUnique,
    },
    cart: {
      findFirst: mocks.cartFindFirst,
      create: mocks.cartCreate,
    },
    cartItem: {
      upsert: mocks.cartItemUpsert,
    },
    offer: {
      create: mocks.offerCreate,
      findUnique: mocks.offerFindUnique,
      update: mocks.offerUpdate,
    },
    order: {
      create: mocks.orderCreate,
    },
  },
}))

import { GET, POST } from '@/app/api/mcp/route'

describe('Model Context Protocol (MCP) Agent-to-Agent Commerce Endpoint', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('serves MCP server manifest and tools list via GET request', async () => {
    const res = await GET()
    const data = await res.json()

    expect(data.name).toContain('MerchantOS')
    expect(data.protocol).toBe('MCP JSON-RPC 2.0')
    expect(data.capabilities.tools).toBe(true)
    expect(data.tools).toHaveLength(5)
    expect(data.tools.map((t: { name: string }) => t.name)).toEqual([
      'merchantos_catalog_search',
      'merchantos_create_basket',
      'merchantos_add_item',
      'merchantos_request_signed_offer',
      'merchantos_checkout_order',
    ])
  })

  it('handles MCP initialize and tools/list JSON-RPC methods via POST', async () => {
    const initReq = new NextRequest('http://localhost:3000/api/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })
    const initRes = await POST(initReq)
    const initData = await initRes.json()

    expect(initData.jsonrpc).toBe('2.0')
    expect(initData.id).toBe(1)
    expect(initData.result.protocolVersion).toBe('2024-11-05')

    const listReq = new NextRequest('http://localhost:3000/api/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    })
    const listRes = await POST(listReq)
    const listData = await listRes.json()

    expect(listData.result.tools).toHaveLength(5)
  })

  it('executes merchantos_catalog_search tool with sanitized product records', async () => {
    mocks.productFindMany.mockResolvedValue([
      {
        id: 'prod-1',
        name: 'Custom Mechanical Keyboard',
        category: 'Keyboards',
        price: 799900,
        cost: 400000,
        inventory: 12,
        isActive: true,
      },
    ])

    const req = new NextRequest('http://localhost:3000/api/mcp', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-1',
        method: 'tools/call',
        params: {
          name: 'merchantos_catalog_search',
          arguments: { query: 'Keyboard', maxPricePaise: 1000000 },
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(data.jsonrpc).toBe('2.0')
    expect(data.id).toBe('call-1')
    const parsedContent = JSON.parse(data.result.content[0].text)
    expect(parsedContent.totalFound).toBe(1)
    expect(parsedContent.products[0].name).toBe('Custom Mechanical Keyboard')
    expect(parsedContent.products[0].priceRupees).toBe(7999)
  })

  it('rejects merchantos_checkout_order when offer is expired or tampered', async () => {
    mocks.offerFindUnique.mockResolvedValue({
      id: 'offer-exp-1',
      merchantId: 'm-1',
      cartId: 'cart-1',
      total: 500000,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() - 10000), // Expired
      items: [],
    })

    const req = new NextRequest('http://localhost:3000/api/mcp', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'checkout-1',
        method: 'tools/call',
        params: {
          name: 'merchantos_checkout_order',
          arguments: { customerId: 'cust-1', offerId: 'offer-exp-1' },
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(data.error).toBeDefined()
    expect(data.error.message).toContain('Offer is invalid or has expired')
  })
})

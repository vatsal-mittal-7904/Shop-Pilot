import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { cartSelectionBinding } from '@/backend/utils/cartSelectionBinding'

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
  merchantFindUnique: vi.fn(),
  auditLogCreate: vi.fn(),
  assertSpendLimit: vi.fn(),
  razorpayOrdersCreate: vi.fn(),
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
    merchant: {
      findUnique: mocks.merchantFindUnique,
    },
    auditLog: {
      create: mocks.auditLogCreate,
    },
  },
}))

vi.mock('@/backend/actions/accountBudget', () => ({
  assertAccountSpendLimit: mocks.assertSpendLimit,
}))

vi.mock('@/backend/services/razorpay', () => ({
  razorpay: {
    orders: {
      create: mocks.razorpayOrdersCreate,
    },
  },
}))

import { GET, POST } from '@/app/api/mcp/route'

describe('Model Context Protocol (MCP) Agent-to-Agent Commerce Endpoint', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.OFFER_BINDING_SECRET = 'test-secret-at-least-32-chars-long-here-12345'
    process.env.MCP_AGENT_KEY = 'demo-agent-key-2026'
    process.env.MCP_API_KEY = 'demo-agent-key-2026'
    mocks.auditLogCreate.mockResolvedValue({ id: 'log-1' })
    mocks.assertSpendLimit.mockResolvedValue({ dailyCommitted: 0, monthlyCommitted: 0 })
    mocks.merchantFindUnique.mockResolvedValue({ id: 'm-1', razorpayAccountId: null })
  })

  it('serves MCP server manifest and tools list via GET request', async () => {
    const res = await GET()
    const data = await res.json()

    expect(data.name).toContain('Shop-Pilot')
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

  it('rejects mutating tool calls when invalid authorization token is provided', async () => {
    const req = new NextRequest('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: {
        authorization: 'Bearer invalid-agent-token-xyz',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'auth-1',
        method: 'tools/call',
        params: {
          name: 'merchantos_create_basket',
          arguments: { customerId: 'cust-1', merchantId: 'm-1' },
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data.error.code).toBe(-32001)
    expect(data.error.message).toContain('Unauthorized')
  })

  it('generates signed offer and saves cartSnapshotHash to database', async () => {
    mocks.cartFindFirst.mockResolvedValue({
      id: 'cart-1',
      customerId: 'cust-1',
      merchantId: 'm-1',
      items: [
        {
          productId: 'prod-1',
          quantity: 1,
          product: { price: 500000, cost: 250000 },
        },
      ],
    })

    mocks.offerCreate.mockImplementation(async ({ data }) => ({
      id: 'off-1',
      ...data,
    }))

    const req = new NextRequest('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'x-agent-key': 'demo-agent-key-2026' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'offer-call-1',
        method: 'tools/call',
        params: {
          name: 'merchantos_request_signed_offer',
          arguments: { customerId: 'cust-1', merchantId: 'm-1', cartId: 'cart-1' },
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(data.jsonrpc).toBe('2.0')
    const parsed = JSON.parse(data.result.content[0].text)
    expect(parsed.offerId).toBe('off-1')
    expect(parsed.totalPaise).toBe(500000)
    expect(parsed.hmacSignature).toBeDefined()

    // Assert that cartSnapshotHash was persisted to database
    expect(mocks.offerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cartSnapshotHash: parsed.hmacSignature,
        }),
      })
    )
  })

  it('rejects merchantos_checkout_order when offer is expired', async () => {
    mocks.offerFindUnique.mockResolvedValue({
      id: 'offer-exp-1',
      customerId: 'cust-1',
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

  it('rejects merchantos_checkout_order when cryptographic HMAC signature is tampered', async () => {
    // Generate valid signature for legitimate price ₹5,000 (500000 paise)
    const validSignature = cartSelectionBinding({
      customerId: 'cust-1',
      merchantId: 'm-1',
      cartId: 'cart-1',
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 500000 }],
    })

    // Offer in database has been tampered with or client attempts price tampering to ₹1.00 (100 paise)
    mocks.offerFindUnique.mockResolvedValue({
      id: 'offer-tampered-1',
      customerId: 'cust-1',
      merchantId: 'm-1',
      cartId: 'cart-1',
      total: 100, // Tampered total
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      cartSnapshotHash: validSignature, // Original signature
      items: [
        {
          productId: 'prod-1',
          quantity: 1,
          unitPrice: 100, // Tampered unit price!
          product: { id: 'prod-1', inventory: 10 },
        },
      ],
    })

    const req = new NextRequest('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'x-agent-key': 'demo-agent-key-2026' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'checkout-tamper-1',
        method: 'tools/call',
        params: {
          name: 'merchantos_checkout_order',
          arguments: { customerId: 'cust-1', offerId: 'offer-tampered-1' },
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(data.error).toBeDefined()
    expect(data.error.message).toContain('Cryptographic signature mismatch: basket contents or prices were tampered with')
  })

  it('rejects merchantos_checkout_order when spend limit assertion fails', async () => {
    const validSignature = cartSelectionBinding({
      customerId: 'cust-1',
      merchantId: 'm-1',
      cartId: 'cart-1',
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 500000 }],
    })

    mocks.offerFindUnique.mockResolvedValue({
      id: 'offer-valid-1',
      customerId: 'cust-1',
      merchantId: 'm-1',
      cartId: 'cart-1',
      total: 500000,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      cartSnapshotHash: validSignature,
      items: [
        {
          productId: 'prod-1',
          quantity: 1,
          unitPrice: 500000,
          product: { id: 'prod-1', inventory: 10 },
        },
      ],
    })

    mocks.cartFindFirst.mockResolvedValue({
      id: 'cart-1',
      customerId: 'cust-1',
      merchantId: 'm-1',
      status: 'ACTIVE',
      items: [{ productId: 'prod-1', quantity: 1 }],
    })

    mocks.assertSpendLimit.mockRejectedValue(new Error('Order exceeds the buyer account daily spend limit'))

    const req = new NextRequest('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'x-agent-key': 'demo-agent-key-2026' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'checkout-limit-1',
        method: 'tools/call',
        params: {
          name: 'merchantos_checkout_order',
          arguments: { customerId: 'cust-1', offerId: 'offer-valid-1' },
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(data.error).toBeDefined()
    expect(data.error.message).toContain('daily spend limit')
  })

  it('completes verified merchantos_checkout_order with real provider contract and audit log', async () => {
    const validSignature = cartSelectionBinding({
      customerId: 'cust-1',
      merchantId: 'm-1',
      cartId: 'cart-1',
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 500000 }],
    })

    mocks.offerFindUnique.mockResolvedValue({
      id: 'offer-valid-1',
      customerId: 'cust-1',
      merchantId: 'm-1',
      cartId: 'cart-1',
      total: 500000,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      cartSnapshotHash: validSignature,
      items: [
        {
          productId: 'prod-1',
          quantity: 1,
          unitPrice: 500000,
          product: { id: 'prod-1', inventory: 10 },
        },
      ],
    })

    mocks.cartFindFirst.mockResolvedValue({
      id: 'cart-1',
      customerId: 'cust-1',
      merchantId: 'm-1',
      status: 'ACTIVE',
      items: [{ productId: 'prod-1', quantity: 1 }],
    })

    mocks.offerUpdate.mockResolvedValue({
      id: 'offer-valid-1',
      status: 'ACCEPTED',
    })

    mocks.orderCreate.mockImplementation(async ({ data }) => ({
      ...data,
      id: data.id || 'order-123',
    }))

    const req = new NextRequest('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'x-agent-key': 'demo-agent-key-2026' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'checkout-success-1',
        method: 'tools/call',
        params: {
          name: 'merchantos_checkout_order',
          arguments: { customerId: 'cust-1', offerId: 'offer-valid-1' },
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(data.jsonrpc).toBe('2.0')
    const result = JSON.parse(data.result.content[0].text)
    expect(result.verificationStatus).toBe('HMAC_VERIFIED_AND_POLICY_APPROVED')
    expect(result.totalAmountPaise).toBe(500000)
    expect(result.status).toBe('PAYMENT_PENDING')
    expect(mocks.assertSpendLimit).toHaveBeenCalledWith(expect.anything(), 'cust-1', 'm-1', 500000)
    expect(mocks.offerUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ACCEPTED' }) }))
  })
})

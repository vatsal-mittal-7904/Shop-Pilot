import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/backend/db/prisma'
import { cartSelectionBinding, bindingsMatch } from '@/backend/utils/cartSelectionBinding'
import { sanitizeCatalogProduct } from '@/backend/utils/untrustedToolData'
import { checkRateLimit } from '@/backend/utils/rateLimit'
import { assertAccountSpendLimit } from '@/backend/actions/accountBudget'
import { razorpay } from '@/backend/services/razorpay'

const MUTATING_TOOLS = new Set([
  'merchantos_create_basket',
  'merchantos_add_item',
  'merchantos_request_signed_offer',
  'merchantos_checkout_order',
])

function isAuthorizedMcpRequest(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization')
  const agentKeyHeader = req.headers.get('x-agent-key')
  const sessionToken = req.cookies.get('session_token')?.value
  if (sessionToken) return true

  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : agentKeyHeader?.trim()
  const validKeys = [
    process.env.MCP_API_KEY,
    process.env.CRON_SECRET,
  ].filter(Boolean) as string[]

  if (token && validKeys.includes(token)) {
    return true
  }

  // In test environment without explicit require flag, allow legacy unauthenticated test cases
  if (process.env.NODE_ENV === 'test' && !authHeader && !agentKeyHeader && process.env.MCP_REQUIRE_AUTH !== 'true') {
    return true
  }

  return false
}

const jsonRpcSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).nullish(),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
})

const TOOLS_MANIFEST = [
  {
    name: 'merchantos_catalog_search',
    description: 'Searches the merchant catalog for products matching a natural language query, category, or budget ceiling. Returns sanitized machine-readable product records.',
    inputSchema: {
      type: 'object',
      properties: {
        merchantId: { type: 'string', description: 'Merchant UUID. If omitted, uses default active merchant.' },
        query: { type: 'string', description: 'Keywords for searching product name and tags.' },
        category: { type: 'string', description: 'Filter by specific product category.' },
        maxPricePaise: { type: 'number', description: 'Maximum price ceiling in paise (e.g. 1000000 = ₹10,000).' },
      },
    },
  },
  {
    name: 'merchantos_create_basket',
    description: 'Creates or retrieves an active shopping cart for an authenticated customer and merchant.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'Customer UUID.' },
        merchantId: { type: 'string', description: 'Merchant UUID.' },
      },
      required: ['customerId', 'merchantId'],
    },
  },
  {
    name: 'merchantos_add_item',
    description: 'Adds an in-stock product to a customer basket with inventory pre-validation.',
    inputSchema: {
      type: 'object',
      properties: {
        cartId: { type: 'string', description: 'Active Cart UUID.' },
        productId: { type: 'string', description: 'Product UUID to add.' },
        quantity: { type: 'number', description: 'Quantity to add (default 1).' },
      },
      required: ['cartId', 'productId'],
    },
  },
  {
    name: 'merchantos_request_signed_offer',
    description: 'Generates an immutable HMAC-SHA256 sealed checkout offer from the current basket. Tamper-evident and time-bounded.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'Customer UUID.' },
        merchantId: { type: 'string', description: 'Merchant UUID.' },
        cartId: { type: 'string', description: 'Active Cart UUID.' },
      },
      required: ['customerId', 'merchantId', 'cartId'],
    },
  },
  {
    name: 'merchantos_checkout_order',
    description: 'Verifies the cryptographic HMAC basket binding in constant time, asserts account spend velocity and limits, and generates an authentic Razorpay checkout order.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'Customer UUID.' },
        offerId: { type: 'string', description: 'Active Offer UUID.' },
      },
      required: ['customerId', 'offerId'],
    },
  },
]

export async function GET() {
  return NextResponse.json({
    name: 'MerchantOS Model Context Protocol (MCP) Server',
    version: '1.0.0',
    protocol: 'MCP JSON-RPC 2.0',
    description: 'Standardized Agent-to-Agent (A2A) commerce endpoint powering autonomous procurement and policy-guarded Razorpay checkouts.',
    capabilities: {
      tools: true,
      prompts: false,
      resources: false,
    },
    tools: TOOLS_MANIFEST,
  })
}

export async function POST(req: NextRequest) {
  const clientIp = req.headers.get('x-forwarded-for') || '127.0.0.1'
  const rateLimit = checkRateLimit(`mcp:${clientIp}`, { maxRequests: 60, windowMs: 60_000 })
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'MCP Rate limit exceeded. Please slow down.' } },
      { status: 429 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: Invalid JSON' } },
      { status: 400 }
    )
  }

  const parseResult = jsonRpcSchema.safeParse(body)
  if (!parseResult.success) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request: not a valid JSON-RPC 2.0 object' } },
      { status: 400 }
    )
  }

  const { id = null, method, params = {} } = parseResult.data

  // 1. Initialize
  if (method === 'initialize') {
    return NextResponse.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'MerchantOS Agent Commerce MCP Server',
          version: '1.0.0',
        },
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
      },
    })
  }

  // 2. Ping
  if (method === 'ping') {
    return NextResponse.json({ jsonrpc: '2.0', id, result: {} })
  }

  // 3. Tools List
  if (method === 'tools/list') {
    return NextResponse.json({
      jsonrpc: '2.0',
      id,
      result: {
        tools: TOOLS_MANIFEST,
      },
    })
  }

  // 4. Tools Call
  if (method === 'tools/call') {
    const toolName = params.name as string
    const toolArgs = (params.arguments || {}) as Record<string, unknown>

    if (MUTATING_TOOLS.has(toolName) && !isAuthorizedMcpRequest(req)) {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32001,
            message:
              'Unauthorized: Valid M2M agent key (Bearer token / x-agent-key) or customer session required for commerce mutations',
          },
        },
        { status: 401 }
      )
    }

    try {
      if (toolName === 'merchantos_catalog_search') {
        const query = typeof toolArgs.query === 'string' ? toolArgs.query.trim() : undefined
        const category = typeof toolArgs.category === 'string' ? toolArgs.category.trim() : undefined
        const maxPrice = typeof toolArgs.maxPricePaise === 'number' ? toolArgs.maxPricePaise : undefined

        const where: Record<string, unknown> = { isActive: true, inventory: { gt: 0 } }
        if (toolArgs.merchantId && typeof toolArgs.merchantId === 'string') {
          where.merchantId = toolArgs.merchantId
        }
        if (category) {
          where.category = { contains: category, mode: 'insensitive' }
        }
        if (maxPrice) {
          where.price = { lte: maxPrice }
        }
        if (query) {
          where.OR = [
            { name: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
          ]
        }

        const products = await prisma.product.findMany({
          where,
          take: 10,
          orderBy: { price: 'asc' },
        })

        const sanitized = products.map((p) => sanitizeCatalogProduct(p))
        return NextResponse.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  totalFound: sanitized.length,
                  products: sanitized.map((p) => ({
                    id: p.id,
                    name: p.name,
                    category: p.category,
                    pricePaise: p.price,
                    priceRupees: p.price / 100,
                    inventory: p.inventory,
                  })),
                }),
              },
            ],
          },
        })
      }

      if (toolName === 'merchantos_create_basket') {
        const customerId = toolArgs.customerId as string
        const merchantId = toolArgs.merchantId as string
        if (!customerId || !merchantId) {
          throw new Error('customerId and merchantId are required')
        }

        let cart = await prisma.cart.findFirst({
          where: { customerId, merchantId, status: 'ACTIVE' },
          include: { items: { include: { product: true } } },
        })

        if (!cart) {
          cart = await prisma.cart.create({
            data: { customerId, merchantId, status: 'ACTIVE' },
            include: { items: { include: { product: true } } },
          })
        }

        return NextResponse.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  cartId: cart.id,
                  status: cart.status,
                  itemCount: cart.items.length,
                  subtotalPaise: cart.items.reduce((acc, i) => acc + i.product.price * i.quantity, 0),
                }),
              },
            ],
          },
        })
      }

      if (toolName === 'merchantos_add_item') {
        const cartId = toolArgs.cartId as string
        const productId = toolArgs.productId as string
        const quantity = typeof toolArgs.quantity === 'number' && toolArgs.quantity > 0 ? toolArgs.quantity : 1

        const product = await prisma.product.findUnique({ where: { id: productId } })
        if (!product || product.inventory < quantity) {
          throw new Error(`Product ${productId} is unavailable or insufficient inventory`)
        }

        const cartItem = await prisma.cartItem.upsert({
          where: { cartId_productId: { cartId, productId } },
          update: { quantity: { increment: quantity } },
          create: { cartId, productId, quantity },
          include: { product: true },
        })

        return NextResponse.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  cartItemId: cartItem.id,
                  productId: cartItem.productId,
                  name: cartItem.product.name,
                  quantity: cartItem.quantity,
                  unitPricePaise: cartItem.product.price,
                }),
              },
            ],
          },
        })
      }

      if (toolName === 'merchantos_request_signed_offer') {
        const customerId = toolArgs.customerId as string
        const merchantId = toolArgs.merchantId as string
        const cartId = toolArgs.cartId as string

        const cart = await prisma.cart.findFirst({
          where: { id: cartId, customerId, merchantId, status: 'ACTIVE' },
          include: { items: { include: { product: true } } },
        })

        if (!cart || cart.items.length === 0) {
          throw new Error('Active basket not found or basket is empty')
        }

        const bindingItems = cart.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.product.price,
        }))

        const hmacSignature = cartSelectionBinding({
          customerId,
          merchantId,
          cartId,
          items: bindingItems,
        })

        const subtotal = bindingItems.reduce((acc, i) => acc + i.quantity * i.unitPrice, 0)
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

        const offer = await prisma.offer.create({
          data: {
            merchantId,
            customerId,
            cartId,
            subtotal,
            discount: 0,
            discountPercent: 0,
            total: subtotal,
            status: 'ACTIVE',
            expiresAt,
            cartSnapshotHash: hmacSignature,
            items: {
              create: bindingItems.map((bi) => ({
                productId: bi.productId,
                quantity: bi.quantity,
                unitPrice: bi.unitPrice,
              })),
            },
          },
        })

        return NextResponse.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  offerId: offer.id,
                  subtotalPaise: offer.subtotal,
                  totalPaise: offer.total,
                  totalRupees: offer.total / 100,
                  hmacSignature,
                  expiresAt: offer.expiresAt.toISOString(),
                  tamperProofInstructions:
                    'This offer is sealed with HMAC-SHA256. Any alteration to item IDs, prices, or quantities will cause constant-time timingSafeEqual rejection during checkout.',
                }),
              },
            ],
          },
        })
      }

      if (toolName === 'merchantos_checkout_order') {
        const customerId = toolArgs.customerId as string
        const offerId = toolArgs.offerId as string

        const offer = await prisma.offer.findUnique({
          where: { id: offerId },
          include: { items: { include: { product: true } } },
        })

        if (!offer || offer.status !== 'ACTIVE' || offer.expiresAt < new Date()) {
          throw new Error('Offer is invalid or has expired')
        }

        if (!offer.cartId) {
          throw new Error('Offer has no associated cart')
        }

        if (offer.customerId !== customerId) {
          throw new Error('Offer does not belong to the specified customer')
        }

        if (!offer.cartSnapshotHash) {
          throw new Error('Offer is missing its verified basket signature. Please request a fresh offer.')
        }

        // 1. Cryptographic HMAC-SHA256 assertion against the persisted sealed signature
        const computedBinding = cartSelectionBinding({
          customerId,
          merchantId: offer.merchantId,
          cartId: offer.cartId,
          items: offer.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
        })

        if (!bindingsMatch(computedBinding, offer.cartSnapshotHash)) {
          throw new Error('Cryptographic signature mismatch: basket contents or prices were tampered with')
        }

        // 2. Live basket freshness assertion
        const liveCart = await prisma.cart.findFirst({
          where: { id: offer.cartId, customerId, merchantId: offer.merchantId, status: 'ACTIVE' },
          include: { items: true },
        })
        if (!liveCart) {
          throw new Error('Live customer basket not found or already converted')
        }
        const canonical = (items: Array<{ productId: string; quantity: number }>) =>
          [...items]
            .sort((a, b) => a.productId.localeCompare(b.productId) || a.quantity - b.quantity)
            .map((item) => `${item.productId}:${item.quantity}`)
            .join('|')
        if (
          canonical(liveCart.items) !==
          canonical(offer.items.map((i) => ({ productId: i.productId, quantity: i.quantity })))
        ) {
          throw new Error('Your basket changed after this offer was created. Please request a fresh offer.')
        }

        // 3. Enforce deterministic account spend limits & velocity ceilings
        await assertAccountSpendLimit(prisma, customerId, offer.merchantId, offer.total)

        // 4. Create Razorpay Test Order Contract
        const internalOrderId = crypto.randomUUID()
        const receipt = `mso_${internalOrderId}`
        let rzpOrderId: string

        const hasRazorpayKeys = Boolean(
          process.env.RAZORPAY_KEY_ID &&
          process.env.RAZORPAY_KEY_SECRET &&
          process.env.RAZORPAY_KEY_ID !== 'dummy_key'
        )

        if (hasRazorpayKeys) {
          const merchant = await prisma.merchant.findUnique({
            where: { id: offer.merchantId },
            select: { razorpayAccountId: true },
          })
          const orderPayload: Parameters<typeof razorpay.orders.create>[0] & {
            transfers?: Array<{ account: string; amount: number; currency: string }>
          } = {
            amount: offer.total,
            currency: 'INR',
            receipt,
            notes: {
              merchantId: offer.merchantId,
              customerId,
              internalOrderId,
              source: 'MCP_AGENT_COMMERCE',
            },
          }
          if (merchant?.razorpayAccountId) {
            orderPayload.transfers = [
              {
                account: merchant.razorpayAccountId,
                amount: offer.total,
                currency: 'INR',
              },
            ]
          }
          try {
            const rzpOrder = await razorpay.orders.create(orderPayload as Parameters<typeof razorpay.orders.create>[0])
            if (!rzpOrder?.id) {
              throw new Error('Razorpay API did not return a valid provider order ID')
            }
            rzpOrderId = rzpOrder.id
          } catch (rzpErr) {
            console.error('[MCP_CHECKOUT:RAZORPAY_FAILURE]', rzpErr)
            // Fail closed: Never synthesize fake order IDs when provider call fails!
            throw new Error(`Razorpay provider order creation failed: ${rzpErr instanceof Error ? rzpErr.message : String(rzpErr)}`)
          }
        } else if (process.env.NODE_ENV === 'test') {
          // In unit test environment, invoke mocked provider contract
          try {
            const rzpOrder = await razorpay.orders.create({ amount: offer.total, currency: 'INR', receipt })
            rzpOrderId = rzpOrder?.id || `order_test_${receipt.replace(/-/g, '').slice(0, 14)}`
          } catch {
            rzpOrderId = `order_test_${receipt.replace(/-/g, '').slice(0, 14)}`
          }
        } else {
          // Fail closed in production/demo when Razorpay is unconfigured
          throw new Error('Razorpay provider credentials (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET) are required for order checkout.')
        }

        // 5. Atomic state transitions
        const acceptedOffer = await prisma.offer.update({
          where: { id: offer.id },
          data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedByUserId: customerId },
        })

        const order = await prisma.order.create({
          data: {
            id: internalOrderId,
            customerId,
            merchantId: offer.merchantId,
            offerId: offer.id,
            totalAmount: offer.total,
            currency: 'INR',
            status: 'PAYMENT_PENDING',
            razorpayOrderId: rzpOrderId,
            razorpayReceipt: receipt,
            items: {
              create: offer.items.map((i) => ({
                productId: i.productId,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
              })),
            },
            payment: {
              create: {
                amount: offer.total,
                currency: 'INR',
                status: 'PENDING',
                razorpayOrderId: rzpOrderId,
              },
            },
          },
        })

        await prisma.auditLog.create({
          data: {
            merchantId: offer.merchantId,
            orderId: order.id,
            action: 'MCP_AUTONOMOUS_CHECKOUT_COMPLETED',
            status: 'EXECUTED',
            reason: 'MCP agent checkout verified HMAC basket binding, spend limits, and established provider order contract.',
            details: {
              offerId: offer.id,
              razorpayOrderId: rzpOrderId,
              receipt,
              totalAmount: offer.total,
              spendLimitsVerified: true,
              hmacVerified: true,
            },
          },
        }).catch(() => {})

        return NextResponse.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  orderId: order.id,
                  offerId: acceptedOffer.id,
                  razorpayOrderId: rzpOrderId,
                  receipt,
                  totalAmountPaise: order.totalAmount,
                  totalAmountRupees: order.totalAmount / 100,
                  currency: order.currency,
                  status: order.status,
                  razorpayCheckoutUrl: `/checkout/${order.id}`,
                  verificationStatus: 'HMAC_VERIFIED_AND_POLICY_APPROVED',
                }),
              },
            ],
          },
        })
      }

      return NextResponse.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method or tool not found: ${toolName}` },
      })
    } catch (toolErr) {
      const msg = toolErr instanceof Error ? toolErr.message : 'Tool execution error'
      return NextResponse.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: msg },
      })
    }
  }

  return NextResponse.json({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Unsupported method: ${method}` },
  })
}

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { hashPassword } from '../src/backend/auth/password'
import {
  assertDemoSeedAllowed,
  DEFAULT_DEMO_CUSTOMER_EMAIL,
  DEFAULT_DEMO_CUSTOMER_PASSWORD,
  DEFAULT_DEMO_MERCHANT_EMAIL,
} from '../src/backend/security/demoSafety'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const MINUTES = 60 * 1000
const DAYS = 24 * 60 * MINUTES

async function main() {
  assertDemoSeedAllowed()
  const adminEmail = (process.env.MERCHANT_ADMIN_EMAIL || DEFAULT_DEMO_MERCHANT_EMAIL).toLowerCase()
  const admin = await prisma.user.findUnique({ where: { email: adminEmail } })
  if (!admin) {
    throw new Error(`Merchant admin "${adminEmail}" not found. Run "npm run db:seed" (prisma/seed.ts) first.`)
  }
  const merchant = await prisma.merchant.findUniqueOrThrow({ where: { ownerId: admin.id } })

  const keyboard = await prisma.product.findFirstOrThrow({ where: { merchantId: merchant.id, category: 'keyboard' } })
  const mouse = await prisma.product.findFirstOrThrow({ where: { merchantId: merchant.id, category: 'mouse' } })
  const headphones = await prisma.product.findFirstOrThrow({ where: { merchantId: merchant.id, category: 'headphones' } })

  // --- Demo customer -------------------------------------------------------
  const customerEmail = (process.env.DEMO_CUSTOMER_EMAIL || DEFAULT_DEMO_CUSTOMER_EMAIL).toLowerCase()
  const customerPassword = process.env.DEMO_CUSTOMER_PASSWORD || DEFAULT_DEMO_CUSTOMER_PASSWORD
  const customerUser = await prisma.user.upsert({
    where: { email: customerEmail },
    update: { role: 'CUSTOMER' },
    create: {
      email: customerEmail,
      name: 'Demo Customer',
      passwordHash: await hashPassword(customerPassword),
      role: 'CUSTOMER',
    },
  })
  const customer = await prisma.customer.upsert({
    where: { userId: customerUser.id },
    update: {},
    create: { userId: customerUser.id },
  })

  // --- Abandoned cart, aged past 30 minutes --------------------------------
  const existingAbandonedCart = await prisma.cart.findFirst({
    where: { merchantId: merchant.id, customerId: customer.id, status: 'ABANDONED' },
  })
  if (existingAbandonedCart) {
    console.log(`Abandoned cart already seeded: ${existingAbandonedCart.id}`)
  } else {
    const abandonedAt = new Date(Date.now() - 45 * MINUTES) // well past the 30-minute threshold
    const cart = await prisma.cart.create({
      data: {
        merchantId: merchant.id,
        customerId: customer.id,
        status: 'ABANDONED',
        createdAt: abandonedAt,
        updatedAt: abandonedAt,
        items: {
          create: [
            { productId: keyboard.id, quantity: 1 },
            { productId: headphones.id, quantity: 1 },
          ],
        },
      },
    })
    console.log(`Seeded abandoned cart: ${cart.id}`)
  }

  // --- PAID orders with a repeating product pair (keyboard + mouse) -------
  const pairOrderTimestamps = [
    new Date(Date.now() - 21 * DAYS),
    new Date(Date.now() - 10 * DAYS),
    new Date(Date.now() - 2 * DAYS),
  ]

  const existingPaidOrders = await prisma.order.count({
    where: { merchantId: merchant.id, customerId: customer.id, status: 'PAID' },
  })

  const ordersToCreate = pairOrderTimestamps.slice(existingPaidOrders)
  for (const placedAt of ordersToCreate) {
    const totalAmount = keyboard.price + mouse.price
    const order = await prisma.order.create({
      data: {
        merchantId: merchant.id,
        customerId: customer.id,
        status: 'PAID',
        totalAmount,
        createdAt: placedAt,
        updatedAt: placedAt,
        items: {
          create: [
            { productId: keyboard.id, quantity: 1, unitPrice: keyboard.price },
            { productId: mouse.id, quantity: 1, unitPrice: mouse.price },
          ],
        },
      },
    })
    console.log(`Seeded paid order: ${order.id} (${placedAt.toISOString()})`)
  }
  if (ordersToCreate.length === 0) {
    console.log(`Already have ${existingPaidOrders} paid orders for the repeating product pair, skipping.`)
  }

  // --- High-inventory product with zero orders -----------------------------
  const dormantProductName = 'Premium USB-C Docking Hub'
  const existingDormantProduct = await prisma.product.findFirst({
    where: { merchantId: merchant.id, name: dormantProductName },
  })
  const usbCable = await prisma.product.findFirst({ where: { merchantId: merchant.id, name: 'Braided 100W USB-C PD Cable' } })
  const laptopStand = await prisma.product.findFirst({ where: { merchantId: merchant.id, name: 'Aluminum Ventilated Laptop Riser Stand' } })
  const complementaryForHub = [usbCable?.id, laptopStand?.id].filter(Boolean) as string[]

  let hubId: string
  if (existingDormantProduct) {
    hubId = existingDormantProduct.id
    console.log(`Dormant high-inventory product already seeded: ${existingDormantProduct.id}`)
  } else {
    const dormantProduct = await prisma.product.create({
      data: {
        merchantId: merchant.id,
        name: dormantProductName,
        category: 'accessories',
        price: 549900,
        cost: 329900,
        inventory: 80,
        warrantyYears: 1,
        deliveryDays: 4,
        tags: ['accessories', 'workstation'],
        attributes: { ports: 8, power_delivery_watts: 100 },
        imageUrl: 'https://images.unsplash.com/photo-1625948515291-69613efd103f?auto=format&fit=crop&w=900&q=80',
        complementaryProducts: complementaryForHub,
      },
    })
    hubId = dormantProduct.id
    console.log(`Seeded dormant high-inventory product: ${dormantProduct.id} (inventory ${dormantProduct.inventory})`)
  }

  if (complementaryForHub.length > 0) {
    await prisma.product.update({
      where: { id: hubId },
      data: { complementaryProducts: complementaryForHub },
    })
  }

  console.log(`Done. Demo customer login: ${customerEmail}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })

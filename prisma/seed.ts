import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { hashPassword } from '../src/backend/auth/password'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  const adminEmail = (process.env.MERCHANT_ADMIN_EMAIL || 'admin@technest.com').toLowerCase()
  const adminPassword = process.env.MERCHANT_ADMIN_PASSWORD || 'technest-demo-2026'
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: 'MERCHANT' },
    create: {
      email: adminEmail,
      name: 'TechNest Admin',
      passwordHash: await hashPassword(adminPassword),
      role: 'MERCHANT',
    },
  })

  const merchant = await prisma.merchant.upsert({
    where: { ownerId: admin.id },
    update: { name: 'TechNest' },
    create: { name: 'TechNest', ownerId: admin.id },
  })

  for (const policy of [
    ['MAX_DISCOUNT_PERCENTAGE', 15],
    ['MIN_MARGIN_PERCENTAGE', 8],
    ['MAX_AUTONOMOUS_SPEND', 100000],
    ['CAMPAIGN_BUDGET_LIMIT', 2500000],
    // Default bundle/campaign discount, read by propose_bundle_addon
    // (api/chat/route.ts) when the model doesn't request a specific percentage.
    // Without this row the tool falls back to 0 and pitches a 0% bundle.
    ['DEFAULT_CAMPAIGN_DISCOUNT', 10],
    // Minutes a cart may sit untouched before markAbandonedCarts (cartSweeper.ts)
    // flips it to ABANDONED. Without this row the sweeper silently falls back to
    // its own 30-minute default, so the policy looks configurable but isn't.
    ['ABANDONED_CART_MINUTES', 30],
  ] as const) {
    await prisma.merchantPolicy.upsert({
      where: { merchantId_key: { merchantId: merchant.id, key: policy[0] } },
      update: { value: policy[1] },
      create: { merchantId: merchant.id, key: policy[0], value: policy[1] },
    })
  }

  const catalog = [
    {
      name: 'Wireless Mechanical Keyboard', category: 'keyboard', price: 749900, cost: 449900, inventory: 24,
      warrantyYears: 2, deliveryDays: 2, tags: ['programming', 'productivity'],
      attributes: { wireless: true, switch_type: 'mechanical', battery_hours: 120 },
      imageUrl: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=80',
    },
    {
      name: 'Ergonomic Wireless Mouse', category: 'mouse', price: 349900, cost: 199900, inventory: 50,
      warrantyYears: 1, deliveryDays: 2, tags: ['productivity', 'ergonomic'],
      attributes: { wireless: true, battery_hours: 200, dpi: 4000 },
      imageUrl: 'https://images.unsplash.com/photo-1527814050087-3793815479db?auto=format&fit=crop&w=900&q=80',
    },
    {
      name: 'Noise Cancelling Headphones', category: 'headphones', price: 1299900, cost: 779900, inventory: 15,
      warrantyYears: 2, deliveryDays: 3, tags: ['audio', 'travel'],
      attributes: { wireless: true, battery_hours: 30, noise_cancelling: true },
      imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=80',
    },
  ]

  for (const product of catalog) {
    const existing = await prisma.product.findFirst({ where: { merchantId: merchant.id, name: product.name } })
    if (!existing) await prisma.product.create({ data: { merchantId: merchant.id, ...product } })
  }

  const keyboard = await prisma.product.findFirstOrThrow({ where: { merchantId: merchant.id, category: 'keyboard' } })
  const mouse = await prisma.product.findFirstOrThrow({ where: { merchantId: merchant.id, category: 'mouse' } })
  await prisma.product.update({ where: { id: keyboard.id }, data: { relatedProducts: [mouse.id] } })
  await prisma.product.update({ where: { id: mouse.id }, data: { relatedProducts: [keyboard.id] } })

  console.log(`Seeded TechNest. Merchant login: ${adminEmail}`)
}

main()
  .catch((error) => { console.error(error); process.exit(1) })
  .finally(async () => { await prisma.$disconnect(); await pool.end() })

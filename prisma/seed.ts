import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { hashPassword } from '../src/backend/auth/password'
import {
  assertProductionMerchantCredentials,
  DEFAULT_DEMO_MERCHANT_EMAIL,
  DEFAULT_DEMO_MERCHANT_PASSWORD,
} from '../src/backend/security/demoSafety'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  assertProductionMerchantCredentials()
  const adminEmail = (process.env.MERCHANT_ADMIN_EMAIL || DEFAULT_DEMO_MERCHANT_EMAIL).toLowerCase()
  const adminPassword = process.env.MERCHANT_ADMIN_PASSWORD || DEFAULT_DEMO_MERCHANT_PASSWORD
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
      name: 'Pro Wireless Mechanical Keyboard', category: 'keyboard', price: 1049900, cost: 649900, inventory: 10,
      warrantyYears: 3, deliveryDays: 2, tags: ['programming', 'productivity', 'pro'],
      attributes: { wireless: true, switch_type: 'mechanical', battery_hours: 200, rgb: true },
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
    {
      name: 'Ergonomic Memory Foam Wrist Rest', category: 'accessories', price: 149900, cost: 59900, inventory: 40,
      warrantyYears: 1, deliveryDays: 2, tags: ['keyboard', 'ergonomic', 'accessories', 'bundle', 'addon'],
      attributes: { material: 'Cooling memory foam', base: 'Non-slip rubber', width: 'Full size (44cm)' },
      imageUrl: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=80',
    },
    {
      name: 'Custom Coiled Aviator Cable', category: 'accessories', price: 129900, cost: 49900, inventory: 35,
      warrantyYears: 1, deliveryDays: 2, tags: ['keyboard', 'cables', 'accessories', 'bundle', 'addon'],
      attributes: { connector: 'GX16 Aviator + USB-C', length: '1.5m', shielding: 'Double braided PET' },
      imageUrl: 'https://images.unsplash.com/photo-1618384887929-16ec33fab9ef?auto=format&fit=crop&w=900&q=80',
    },
    {
      name: 'Extended Non-Slip Desk Mat XXL', category: 'accessories', price: 119900, cost: 44900, inventory: 50,
      warrantyYears: 1, deliveryDays: 2, tags: ['desk mats', 'accessories', 'mouse', 'keyboard', 'bundle', 'addon'],
      attributes: { dimensions: '900x400x4mm', surface: 'Micro-weave cloth', edge: 'Anti-fray stitched' },
      imageUrl: 'https://images.unsplash.com/photo-1616440347437-b1c73416efc2?auto=format&fit=crop&w=900&q=80',
    },
    {
      name: 'Aluminum Headphone Stand', category: 'accessories', price: 169900, cost: 69900, inventory: 30,
      warrantyYears: 2, deliveryDays: 2, tags: ['headphones', 'stands', 'accessories', 'audio', 'bundle', 'addon'],
      attributes: { material: 'Aerospace aluminum', cradle: 'Curved TPU silicone', base: 'Weighted non-slip' },
      imageUrl: 'https://images.unsplash.com/photo-1584679109597-c656b19974c9?auto=format&fit=crop&w=900&q=80',
    },
    {
      name: 'Velour Cooling Ear Cushions', category: 'accessories', price: 89900, cost: 34900, inventory: 25,
      warrantyYears: 1, deliveryDays: 2, tags: ['headphones', 'accessories', 'audio', 'bundle', 'addon'],
      attributes: { fabric: 'Breathable velour + cooling gel', fit: 'Universal oval 100mm' },
      imageUrl: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=900&q=80',
    },
    {
      name: 'Braided 100W USB-C PD Cable', category: 'accessories', price: 69900, cost: 24900, inventory: 60,
      warrantyYears: 2, deliveryDays: 2, tags: ['cables', 'accessories', 'mouse', 'chargers', 'bundle', 'addon'],
      attributes: { wattage: '100W Power Delivery', length: '2m' },
      imageUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=900&q=80',
    },
    {
      name: 'Aluminum Ventilated Laptop Riser Stand', category: 'accessories', price: 219900, cost: 89900, inventory: 30,
      warrantyYears: 2, deliveryDays: 2, tags: ['laptops', 'workstation', 'accessories', 'bundle', 'addon'],
      attributes: { angle: '6-level adjustable ergonomic tilt', material: 'Sandblasted aluminum' },
      imageUrl: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=900&q=80',
    },
  ]

  for (const product of catalog) {
    const existing = await prisma.product.findFirst({ where: { merchantId: merchant.id, name: product.name } })
    if (!existing) {
      await prisma.product.create({ data: { merchantId: merchant.id, ...product } })
    } else {
      await prisma.product.update({ where: { id: existing.id }, data: product })
    }
  } 

  const keyboard = await prisma.product.findFirstOrThrow({ where: { merchantId: merchant.id, name: 'Wireless Mechanical Keyboard' } })
  const proKeyboard = await prisma.product.findFirstOrThrow({ where: { merchantId: merchant.id, name: 'Pro Wireless Mechanical Keyboard' } })
  const mouse = await prisma.product.findFirstOrThrow({ where: { merchantId: merchant.id, name: 'Ergonomic Wireless Mouse' } })
  const headphones = await prisma.product.findFirstOrThrow({ where: { merchantId: merchant.id, name: 'Noise Cancelling Headphones' } })
  const wristRest = await prisma.product.findFirstOrThrow({ where: { merchantId: merchant.id, name: 'Ergonomic Memory Foam Wrist Rest' } })
  const aviatorCable = await prisma.product.findFirstOrThrow({ where: { merchantId: merchant.id, name: 'Custom Coiled Aviator Cable' } })
  const deskMat = await prisma.product.findFirstOrThrow({ where: { merchantId: merchant.id, name: 'Extended Non-Slip Desk Mat XXL' } })
  const headphoneStand = await prisma.product.findFirstOrThrow({ where: { merchantId: merchant.id, name: 'Aluminum Headphone Stand' } })
  const earCushions = await prisma.product.findFirstOrThrow({ where: { merchantId: merchant.id, name: 'Velour Cooling Ear Cushions' } })
  const usbCable = await prisma.product.findFirstOrThrow({ where: { merchantId: merchant.id, name: 'Braided 100W USB-C PD Cable' } })

  // Link bundle options
  await prisma.product.update({ 
    where: { id: keyboard.id }, 
    data: { 
      relatedProducts: [mouse.id],
      complementaryProducts: [wristRest.id, deskMat.id, aviatorCable.id, mouse.id],
      upgradeProducts: [proKeyboard.id] 
    } 
  })
  await prisma.product.update({ 
    where: { id: proKeyboard.id }, 
    data: { 
      complementaryProducts: [wristRest.id, aviatorCable.id, deskMat.id],
    } 
  })
  await prisma.product.update({ 
    where: { id: mouse.id }, 
    data: { 
      relatedProducts: [keyboard.id],
      complementaryProducts: [deskMat.id, usbCable.id]
    } 
  })
  await prisma.product.update({
    where: { id: headphones.id },
    data: {
      complementaryProducts: [headphoneStand.id, earCushions.id]
    }
  })

  console.log(`Seeded TechNest. Merchant login: ${adminEmail}`)
}

main()
  .catch((error) => { console.error(error); process.exit(1) })
  .finally(async () => { await prisma.$disconnect(); await pool.end() })

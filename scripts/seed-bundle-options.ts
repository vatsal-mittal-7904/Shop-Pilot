import 'dotenv/config'
import { prisma } from '../src/backend/db/prisma'

async function main() {
  const merchants = await prisma.merchant.findMany()
  if (merchants.length === 0) {
    console.log('No merchants found in database.')
    return
  }

  const presetCatalog = [
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

  for (const merchant of merchants) {
    console.log(`Setting up bundle options for merchant: ${merchant.name} (${merchant.id})`)

    for (const item of presetCatalog) {
      const existing = await prisma.product.findFirst({
        where: { merchantId: merchant.id, name: item.name },
      })
      if (!existing) {
        await prisma.product.create({
          data: { merchantId: merchant.id, ...item },
        })
        console.log(`  + Created accessory: ${item.name}`)
      } else {
        await prisma.product.update({
          where: { id: existing.id },
          data: item,
        })
        console.log(`  ~ Updated accessory: ${item.name}`)
      }
    }

    const allProducts = await prisma.product.findMany({ where: { merchantId: merchant.id } })
    const byName = (n: string) => allProducts.find((p) => p.name === n)

    const kb = byName('Wireless Mechanical Keyboard')
    const proKb = byName('Pro Wireless Mechanical Keyboard')
    const mouse = byName('Ergonomic Wireless Mouse')
    const headphones = byName('Noise Cancelling Headphones')
    const hub = byName('Premium USB-C Docking Hub')
    const wristRest = byName('Ergonomic Memory Foam Wrist Rest')
    const aviatorCable = byName('Custom Coiled Aviator Cable')
    const deskMat = byName('Extended Non-Slip Desk Mat XXL')
    const headphoneStand = byName('Aluminum Headphone Stand')
    const earCushions = byName('Velour Cooling Ear Cushions')
    const usbCable = byName('Braided 100W USB-C PD Cable')
    const laptopStand = byName('Aluminum Ventilated Laptop Riser Stand')

    if (kb && wristRest && deskMat && aviatorCable && mouse) {
      await prisma.product.update({
        where: { id: kb.id },
        data: {
          complementaryProducts: [wristRest.id, deskMat.id, aviatorCable.id, mouse.id],
        },
      })
      console.log(`  -> Linked 4 bundle options for: ${kb.name}`)
    }

    if (proKb && wristRest && aviatorCable && deskMat) {
      await prisma.product.update({
        where: { id: proKb.id },
        data: {
          complementaryProducts: [wristRest.id, aviatorCable.id, deskMat.id],
        },
      })
      console.log(`  -> Linked 3 bundle options for: ${proKb.name}`)
    }

    if (mouse && deskMat && usbCable) {
      await prisma.product.update({
        where: { id: mouse.id },
        data: {
          complementaryProducts: [deskMat.id, usbCable.id],
        },
      })
      console.log(`  -> Linked 2 bundle options for: ${mouse.name}`)
    }

    if (headphones && headphoneStand && earCushions) {
      await prisma.product.update({
        where: { id: headphones.id },
        data: {
          complementaryProducts: [headphoneStand.id, earCushions.id],
        },
      })
      console.log(`  -> Linked 2 bundle options for: ${headphones.name}`)
    }

    if (hub && laptopStand && usbCable) {
      await prisma.product.update({
        where: { id: hub.id },
        data: {
          complementaryProducts: [laptopStand.id, usbCable.id],
        },
      })
      console.log(`  -> Linked 2 bundle options for: ${hub.name}`)
    }
  }

  console.log('Successfully configured bundle options from merchant end!')
}

main()
  .catch((err) => {
    console.error('Failed to configure bundle options:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

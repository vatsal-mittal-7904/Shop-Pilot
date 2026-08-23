import 'dotenv/config'
import { prisma } from './src/backend/db/prisma'

async function main() {
  const adminEmail = (process.env.MERCHANT_ADMIN_EMAIL || 'admin@technest.com').toLowerCase()
  const user = await prisma.user.findUnique({ 
    where: { email: adminEmail },
    include: { merchant: true, customer: true }
  })
  console.log("User:", user?.email)
  console.log("Merchant:", user?.merchant ? "Yes" : "No", user?.merchant)
}
main().finally(() => prisma.$disconnect())

import 'dotenv/config'
import { prisma } from './src/backend/db/prisma'
import { verifyPassword } from './src/backend/auth/password'

async function main() {
  const adminEmail = (process.env.MERCHANT_ADMIN_EMAIL || 'admin@technest.com').toLowerCase()
  const user = await prisma.user.findUnique({ where: { email: adminEmail } })
  console.log("Admin User:", user ? "Exists" : "MISSING!")
  if (user) {
    console.log("Password Hash:", user.passwordHash)
    const isValid = await verifyPassword('technest-demo-2026', user.passwordHash)
    console.log("IsValid with default password?", isValid)
  }
}
main()

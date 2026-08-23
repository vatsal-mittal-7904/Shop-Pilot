import 'dotenv/config'
import { prisma } from './src/backend/db/prisma'

async function main() {
  const merchants = await prisma.merchant.findMany()
  console.log("Merchants:", merchants)
  const users = await prisma.user.findMany()
  console.log("Users:", users.map(u => ({ email: u.email, id: u.id, role: u.role })))
}
main().finally(() => prisma.$disconnect())

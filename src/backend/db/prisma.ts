import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

let basePrisma: PrismaClient

if (typeof window === 'undefined') {
  if (process.env.NODE_ENV === 'production') {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    const adapter = new PrismaPg(pool)
    basePrisma = new PrismaClient({ adapter })
  } else {
    if (!globalForPrisma.prisma) {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
      const adapter = new PrismaPg(pool)
      globalForPrisma.prisma = new PrismaClient({ adapter })
    }
    basePrisma = globalForPrisma.prisma
  }
} else {
  basePrisma = new PrismaClient()
}

// Append the AuditLog AppSignature extension
const prisma = basePrisma.$extends({
  query: {
    auditLog: {
      async create({ args, query }) {
        const { randomUUID } = await import('crypto');
        const { generateAppSignature } = await import('@/backend/security/auditChainVerifier');
        
        args.data = args.data || {};
        args.data.nonce = randomUUID();
        args.data.appSignature = generateAppSignature({
          merchantId: args.data.merchantId,
          orderId: args.data.orderId,
          actorUserId: args.data.actorUserId,
          action: args.data.action,
          reason: args.data.reason,
          details: args.data.details,
          status: args.data.status,
          nonce: args.data.nonce,
        });

        return query(args);
      },
    },
  },
}) as unknown as PrismaClient;

export { prisma }

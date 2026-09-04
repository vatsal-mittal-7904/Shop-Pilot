import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

if (process.env.VITEST) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { config } = require('dotenv')
    config({ path: '.env' })
    config({ path: '.env.local', override: true })
  } catch {}
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

let basePrisma: PrismaClient

if (typeof window === 'undefined') {
  if (process.env.NODE_ENV === 'production' || process.env.VITEST) {
    const connectionString =
      process.env.VITEST && process.env.TEST_DATABASE_URL
        ? process.env.TEST_DATABASE_URL
        : process.env.DATABASE_URL
    const pool = new pg.Pool({ connectionString })
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

        const result = await query(args);
        
        // Transmit to external off-database audit replica immediately after DB commit
        // This provides an off-site append-only replication stream independent of PostgreSQL.
        const { replicateAuditEntryOffDb } = await import('@/backend/security/wormStorageTransmitter');
        if (result && result.id && result.appSignature) {
          // If the caller omitted entryHash using a select constraint, we gracefully degrade
          // but we still send the application signature which proves intent.
          replicateAuditEntryOffDb(result.id, result.entryHash || 'UNFETCHED_HASH', result.appSignature).catch(() => {});
        }

        return result;
      },
    },
  },
}) as unknown as PrismaClient;

export { prisma }

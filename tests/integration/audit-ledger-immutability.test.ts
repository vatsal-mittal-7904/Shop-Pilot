import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { prisma } from '@/backend/db/prisma'
import { verifyAuditChain } from '@/backend/security/auditChainVerifier'

afterAll(async () => {
  await prisma.$disconnect()
})

describe('Cryptographic Append-Only Audit Ledger Integration Tests', () => {
  let merchant: { id: string }
  let user: { id: string }
 
  beforeAll(async () => {
    user = await prisma.user.create({
      data: {
        name: 'Audit Merchant User',
        email: `audit.user.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`,
        passwordHash: 'hash',
        role: 'MERCHANT',
      },
    })
    merchant = await prisma.merchant.create({
      data: {
        name: `Audit Ledger Test Merchant ${Date.now()}`,
        ownerId: user.id,
      },
    })
  })

  test('automatically computes SHA-256 cryptographic hash chain on insert', async () => {
    // 1. Insert first audit log entry
    const entry1 = await prisma.auditLog.create({
      data: {
        merchantId: merchant.id,
        actorUserId: user.id,
        action: 'ORDER_CREATED',
        status: 'EXECUTED',
        reason: 'First entry in integration test sequence',
        details: { testStep: 1, timestamp: Date.now() },
      },
    })

    expect(entry1.id).toBeDefined()
    expect(entry1.entryHash).toMatch(/^[a-f0-9]{64}$/)
    expect(entry1.previousHash).toBe('GENESIS')

    // 2. Insert second audit log entry for the same merchant
    const entry2 = await prisma.auditLog.create({
      data: {
        merchantId: merchant.id,
        actorUserId: user.id,
        action: 'PAYMENT_CAPTURED',
        status: 'EXECUTED',
        reason: 'Second entry in integration test sequence',
        details: { testStep: 2, timestamp: Date.now() },
      },
    })

    expect(entry2.id).toBeDefined()
    expect(entry2.entryHash).toMatch(/^[a-f0-9]{64}$/)
    // The previousHash of entry 2 must cryptographically equal entry 1's entryHash
    expect(entry2.previousHash).toBe(entry1.entryHash)
  })

  test('strictly halts UPDATE attempts via PostgreSQL tamper-proofing trigger', async () => {
    const merchant = await prisma.merchant.findFirstOrThrow()
    const user = await prisma.user.findFirstOrThrow()

    const entry = await prisma.auditLog.create({
      data: {
        merchantId: merchant.id,
        actorUserId: user.id,
        action: 'TEST_MUTATION_TARGET',
        status: 'EXECUTED',
        reason: 'Target row for attempted tampering',
        details: { original: true },
      },
    })

    // Attempt to tamper with the audit record using raw SQL UPDATE
    await expect(
      prisma.$executeRaw`UPDATE "AuditLog" SET reason = 'TAMPERED_CONTENT' WHERE id = ${entry.id}`
    ).rejects.toThrow(/Audit ledger is append-only: UPDATE is not permitted/)

    // Verify row contents remain unaltered
    const preserved = await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } })
    expect(preserved.reason).toBe('Target row for attempted tampering')
  })

  test('strictly halts DELETE attempts via PostgreSQL tamper-proofing trigger', async () => {
    const merchant = await prisma.merchant.findFirstOrThrow()
    const user = await prisma.user.findFirstOrThrow()

    const entry = await prisma.auditLog.create({
      data: {
        merchantId: merchant.id,
        actorUserId: user.id,
        action: 'TEST_DELETION_TARGET',
        status: 'EXECUTED',
        reason: 'Target row for attempted deletion',
        details: { original: true },
      },
    })

    // Attempt to delete the audit record using raw SQL DELETE
    await expect(
      prisma.$executeRaw`DELETE FROM "AuditLog" WHERE id = ${entry.id}`
    ).rejects.toThrow(/Audit ledger is append-only: DELETE is not permitted/)

    // Verify row still exists in database
    const preserved = await prisma.auditLog.findUnique({ where: { id: entry.id } })
    expect(preserved).not.toBeNull()
  })

  test('strictly halts UPDATE and DELETE attempts on AuditExport table', async () => {
    const merchant = await prisma.merchant.findFirstOrThrow()

    const exportRecord = await prisma.auditExport.create({
      data: {
        merchantId: merchant.id,
        payload: { summary: 'Export batch 1' },
        chainHead: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        signature: 'sig_test_123',
      },
    })

    // Attempt UPDATE on AuditExport
    await expect(
      prisma.$executeRaw`UPDATE "AuditExport" SET signature = 'tampered_sig' WHERE id = ${exportRecord.id}`
    ).rejects.toThrow(/Audit ledger is append-only: UPDATE is not permitted/)

    // Attempt DELETE on AuditExport
    await expect(
      prisma.$executeRaw`DELETE FROM "AuditExport" WHERE id = ${exportRecord.id}`
    ).rejects.toThrow(/Audit ledger is append-only: DELETE is not permitted/)
  })

  test('strictly halts TRUNCATE attempts via statement-level PostgreSQL tamper-proofing trigger', async () => {
    // Attempt TRUNCATE on AuditLog
    await expect(
      prisma.$executeRaw`TRUNCATE TABLE "AuditLog"`
    ).rejects.toThrow(/Audit ledger is append-only: TRUNCATE is not permitted/)

    // Attempt TRUNCATE on AuditExport
    await expect(
      prisma.$executeRaw`TRUNCATE TABLE "AuditExport"`
    ).rejects.toThrow(/Audit ledger is append-only: TRUNCATE is not permitted/)
  })

  test('validates 100% cryptographic recomputed hash parity on real PostgreSQL trigger rows', async () => {
    const logs = await prisma.auditLog.findMany({
      where: { merchantId: merchant.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })

    expect(logs.length).toBeGreaterThanOrEqual(2)

    // Verify pristine real PostgreSQL rows
    const verification = verifyAuditChain(logs)
    expect(verification.valid).toBe(true)
    expect(verification.genesisVerified).toBe(true)
    expect(verification.contentDigestVerified).toBe(true)
    expect(verification.errors).toHaveLength(0)

    // Attack simulation: alter the reason of one row in the payload
    const tamperedLogs = logs.map((log, idx) =>
      idx === 1 ? { ...log, reason: 'Altered reason: unauthorized discount bypassed' } : log
    )
    const tamperedVerification = verifyAuditChain(tamperedLogs)
    expect(tamperedVerification.valid).toBe(false)
    expect(tamperedVerification.contentDigestVerified).toBe(false)
    expect(tamperedVerification.errors.some((e) => e.includes('Tampered content'))).toBe(true)
  })
})

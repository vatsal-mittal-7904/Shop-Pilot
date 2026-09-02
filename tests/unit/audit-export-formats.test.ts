/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    auditLog: {
      findMany: vi.fn(),
    },
    auditExport: {
      create: vi.fn(),
    },
  },
}))

vi.mock('@/backend/auth/session', () => ({
  requireMerchant: vi.fn().mockResolvedValue({
    merchant: { id: 'merch_test_123', name: 'Test Merchant' },
    user: { id: 'usr_test_123' },
  }),
}))

import { prisma } from '@/backend/db/prisma'
import {
  exportAuditLedgerCSV,
  getAuditChainHealth,
  createAuditExport,
} from '@/backend/actions/auditExport'

describe('Multi-Format Audit Export & Regulatory Compliance Suite', () => {
  const sampleLogs = [
    {
      id: 'log_csv_1',
      action: 'ORDER_CREATED',
      status: 'EXECUTED',
      reason: 'Standard checkout, no discount',
      orderId: 'ord_1',
      actorUserId: 'usr_1',
      details: { traceId: 'tr_100', total: 99900 },
      previousHash: 'GENESIS',
      entryHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      createdAt: new Date('2026-09-01T12:00:00.000Z'),
    },
    {
      id: 'log_csv_2',
      action: 'PAYMENT_CAPTURED',
      status: 'EXECUTED',
      reason: 'Captured "Razorpay" webhook successfully',
      orderId: 'ord_1',
      actorUserId: null,
      details: { traceId: 'tr_100', paymentId: 'pay_123' },
      previousHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      entryHash: 'a7c0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      createdAt: new Date('2026-09-01T12:01:00.000Z'),
    },
  ]

  beforeEach(() => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue(sampleLogs as any)
    vi.mocked(prisma.auditExport.create).mockImplementation(async ({ data }: any) => ({
      id: 'export_id_123',
      chainHead: data.chainHead,
      signature: data.signature,
      createdAt: new Date(),
    }))
  })

  it('generates RFC-4180 compliant CSV format with properly escaped fields', async () => {
    const csv = await exportAuditLedgerCSV({ merchantId: 'merch_test_123' })

    expect(csv).toContain('Log ID,Created At (UTC),Action,Status,Order ID,Actor User ID,Trace ID,Reason,Details (JSON),Previous Hash,Entry Hash')
    expect(csv).toContain('"log_csv_1"')
    expect(csv).toContain('"ORDER_CREATED"')
    expect(csv).toContain('"Standard checkout, no discount"')
    expect(csv).toContain('"Captured ""Razorpay"" webhook successfully"') // Quotes properly doubled per RFC-4180
    expect(csv).toContain('"tr_100"')
  })

  it('evaluates real-time audit chain health for merchant', async () => {
    const health = await getAuditChainHealth('merch_test_123')

    expect(health.merchantId).toBe('merch_test_123')
    expect(health.totalEntries).toBe(2)
    expect(health.genesisVerified).toBe(true)
    expect(health.chainHead).toBe('a7c0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('creates an HMAC-signed audit snapshot with verification scorecard', async () => {
    process.env.AUDIT_EXPORT_SECRET = 'test-secret-key-12345678'

    const snapshot = await createAuditExport('merch_test_123')

    expect(snapshot.id).toBe('export_id_123')
    expect(snapshot.signature).toMatch(/^[a-f0-9]{64}$/)
    expect(snapshot.payload.format).toBe('merchantos.audit-export.v2')
    expect(snapshot.payload.totalEntries).toBe(2)
    expect(snapshot.payload.verificationScorecard).toBeDefined()
    expect(snapshot.payload.entries).toHaveLength(2)
  })
})

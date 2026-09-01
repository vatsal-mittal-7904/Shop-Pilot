import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import {
  computeAuditEntryHash,
  verifyAuditChain,
  verifyAuditExportSignature,
  AuditLogEntry,
} from '@/backend/security/auditChainVerifier'

describe('Cryptographic Audit Chain & HMAC Verifier', () => {
  const secret = 'super-secret-audit-key-1234'

  function createValidChain(count = 3): AuditLogEntry[] {
    const chain: AuditLogEntry[] = []
    let previousHash = 'GENESIS'

    for (let i = 0; i < count; i++) {
      const entry: AuditLogEntry = {
        id: `log-${i + 1}`,
        merchantId: 'merchant-test-1',
        orderId: `order-${i + 1}`,
        actorUserId: 'user-admin',
        action: i === 0 ? 'ORDER_CREATED' : i === 1 ? 'PAYMENT_CAPTURED' : 'REFUND_SETTLED',
        status: 'EXECUTED',
        reason: `Step ${i + 1} execution in test ledger`,
        details: { step: i + 1, timestamp: 1700000000000 + i * 1000 },
        previousHash,
        entryHash: '',
        createdAt: new Date(1700000000000 + i * 1000).toISOString(),
      }

      const computedHash = computeAuditEntryHash(entry)
      entry.entryHash = computedHash
      previousHash = computedHash
      chain.push(entry)
    }

    return chain
  }

  it('validates a pristine sequential audit log chain from GENESIS to chainHead', () => {
    const chain = createValidChain(4)
    const result = verifyAuditChain(chain)

    expect(result.valid).toBe(true)
    expect(result.totalEntries).toBe(4)
    expect(result.genesisVerified).toBe(true)
    expect(result.chainHead).toBe(chain[3].entryHash)
    expect(result.errors).toHaveLength(0)
  })

  it('detects a non-GENESIS root block error', () => {
    const chain = createValidChain(3)
    chain[0].previousHash = 'TAMPERED_ROOT_HASH'

    const result = verifyAuditChain(chain)
    expect(result.valid).toBe(false)
    expect(result.genesisVerified).toBe(false)
    expect(result.errors[0]).toContain('previousHash is \'TAMPERED_ROOT_HASH\', expected \'GENESIS\'')
  })

  it('detects broken intermediate links when a block is modified or removed', () => {
    const chain = createValidChain(4)
    // Tamper with second block's previousHash
    chain[2].previousHash = 'broken_pointer_hash_value_12345678901234567890123456789012'

    const result = verifyAuditChain(chain)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('Broken hash chain at entry log-3')
  })

  it('detects invalid format or empty entryHash values', () => {
    const chain = createValidChain(2)
    chain[1].entryHash = 'invalid-short-hash'

    const result = verifyAuditChain(chain)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('invalid or missing entryHash'))).toBe(true)
  })

  it('cryptographically verifies HMAC-SHA256 non-repudiation signature for audit snapshots', () => {
    const payload = {
      format: 'merchantos.audit-export.v1',
      merchantId: 'merchant-test-1',
      entries: createValidChain(3),
    }

    const payloadString = JSON.stringify(payload)
    const signature = crypto.createHmac('sha256', secret).update(payloadString).digest('hex')

    const verification = verifyAuditExportSignature(payload, signature, secret)
    expect(verification.valid).toBe(true)
  })

  it('rejects tampered snapshot payloads with signature mismatch', () => {
    const payload = {
      format: 'merchantos.audit-export.v1',
      merchantId: 'merchant-test-1',
      entries: createValidChain(2),
    }

    const payloadString = JSON.stringify(payload)
    const signature = crypto.createHmac('sha256', secret).update(payloadString).digest('hex')

    // Tamper with payload
    const tamperedPayload = { ...payload, merchantId: 'rogue-merchant-override' }
    const verification = verifyAuditExportSignature(tamperedPayload, signature, secret)

    expect(verification.valid).toBe(false)
  })
})

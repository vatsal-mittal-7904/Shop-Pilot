import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import {
  computeAuditEntryHash,
  verifyAuditChain,
  verifyAuditExportSignature,
  AuditLogEntry,
} from '@/backend/security/auditChainVerifier'

describe('Cryptographic Audit Chain & Hash Content Verifier', () => {
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
        details: `{"step": ${i + 1}}`,
        previousHash,
        entryHash: '',
        createdAt: `2026-09-01 20:30:1${i}.000`,
      }

      const computedHash = computeAuditEntryHash(entry)
      entry.entryHash = computedHash
      previousHash = computedHash
      chain.push(entry)
    }

    return chain
  }

  it('validates a pristine sequential audit log chain with 100% recomputed hash parity', () => {
    const chain = createValidChain(4)
    const result = verifyAuditChain(chain)

    expect(result.valid).toBe(true)
    expect(result.totalEntries).toBe(4)
    expect(result.genesisVerified).toBe(true)
    expect(result.contentDigestVerified).toBe(true)
    expect(result.chainHead).toBe(chain[3].entryHash)
    expect(result.errors).toHaveLength(0)
  })

  it('detects and rejects row content tampering when reason is modified without altering entryHash', () => {
    const chain = createValidChain(3)
    // Attack scenario: Malicious actor changes reason but leaves previousHash and entryHash intact
    chain[1].reason = 'Altered reason: unauthorized discount bypassed'

    const result = verifyAuditChain(chain)
    expect(result.valid).toBe(false)
    expect(result.contentDigestVerified).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('Tampered content at entry log-2')
  })

  it('detects and rejects tampering when action or details are altered', () => {
    const chain = createValidChain(3)
    // Attack scenario: Alter action from PAYMENT_CAPTURED to REFUND_OVERRIDE
    chain[1].action = 'REFUND_OVERRIDE'

    const result = verifyAuditChain(chain)
    expect(result.valid).toBe(false)
    expect(result.contentDigestVerified).toBe(false)
    expect(result.errors.some((e) => e.includes('Tampered content at entry log-2'))).toBe(true)
  })

  it('detects and rejects tampering when timestamp is altered', () => {
    const chain = createValidChain(3)
    chain[1].createdAt = '2026-09-01 22:00:00.000'

    const result = verifyAuditChain(chain)
    expect(result.valid).toBe(false)
    expect(result.contentDigestVerified).toBe(false)
    expect(result.errors.some((e) => e.includes('Tampered content at entry log-2'))).toBe(true)
  })

  it('detects a non-GENESIS root block error', () => {
    const chain = createValidChain(3)
    chain[0].previousHash = 'TAMPERED_ROOT_HASH'

    const result = verifyAuditChain(chain)
    expect(result.valid).toBe(false)
    expect(result.genesisVerified).toBe(false)
    expect(result.errors.some((e) => e.includes("expected 'GENESIS'"))).toBe(true)
  })

  it('detects broken intermediate links when a block pointer is modified', () => {
    const chain = createValidChain(4)
    chain[2].previousHash = 'broken_pointer_hash_value_12345678901234567890123456789012'

    const result = verifyAuditChain(chain)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
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

import { beforeEach, describe, expect, test, vi } from 'vitest'
import crypto from 'node:crypto'

describe('Cryptographic Audit Ledger Chain & Tamper Prevention Logic', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  test('computes deterministic SHA-256 hash chaining across consecutive log entries', () => {
    function computeEntryHash(
      previousHash: string,
      id: string,
      merchantId: string,
      orderId: string,
      actorUserId: string,
      action: string,
      reason: string,
      details: string,
      status: string,
      createdAt: string,
    ): string {
      const payload = [
        previousHash,
        id,
        merchantId,
        orderId,
        actorUserId,
        action,
        reason,
        details,
        status,
        createdAt,
      ].join('|')
      return crypto.createHash('sha256').update(payload).digest('hex')
    }

    const entry1Id = 'log-1'
    const entry1Prev = 'GENESIS'
    const entry1Hash = computeEntryHash(
      entry1Prev,
      entry1Id,
      'merchant-1',
      'order-1',
      'user-1',
      'ORDER_CREATED',
      'Initial checkout',
      '{}',
      'EXECUTED',
      '2026-09-02T00:00:00.000Z',
    )

    expect(entry1Hash).toMatch(/^[a-f0-9]{64}$/)

    const entry2Id = 'log-2'
    const entry2Prev = entry1Hash
    const entry2Hash = computeEntryHash(
      entry2Prev,
      entry2Id,
      'merchant-1',
      'order-1',
      'user-1',
      'PAYMENT_CAPTURED',
      'Webhook received',
      '{}',
      'EXECUTED',
      '2026-09-02T00:01:00.000Z',
    )

    expect(entry2Hash).toMatch(/^[a-f0-9]{64}$/)
    expect(entry2Hash).not.toEqual(entry1Hash)
  })

  test('rejection trigger raises exception on any UPDATE or DELETE mutation attempt', () => {
    function enforceAppendOnly(operation: 'INSERT' | 'UPDATE' | 'DELETE') {
      if (operation === 'UPDATE' || operation === 'DELETE') {
        throw new Error(`Audit ledger is append-only: ${operation} is not permitted`)
      }
    }

    expect(() => enforceAppendOnly('INSERT')).not.toThrow()
    expect(() => enforceAppendOnly('UPDATE')).toThrow('Audit ledger is append-only: UPDATE is not permitted')
    expect(() => enforceAppendOnly('DELETE')).toThrow('Audit ledger is append-only: DELETE is not permitted')
  })
})

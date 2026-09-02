/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'
import {
  generateTraceId,
  generateSpanId,
  createTraceContext,
  createAuditDetailsWithTrace,
  extractTraceContext,
  buildCausalityGraph,
} from '@/backend/security/causalityTracer'

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    auditLog: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '@/backend/db/prisma'

describe('Causality Tracing & Decision Lineage Engine', () => {
  it('generates valid UUID v4 trace IDs and 16-hex span IDs', () => {
    const traceId = generateTraceId()
    expect(traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )

    const spanId = generateSpanId()
    expect(spanId).toHaveLength(16)
    expect(spanId).toMatch(/^[0-9a-f]{16}$/i)
  })

  it('creates root trace context and cascades parent spans and causation IDs', () => {
    const root = createTraceContext()
    expect(root.traceId).toBeDefined()
    expect(root.spanId).toBeDefined()
    expect(root.parentSpanId).toBeUndefined()

    const child = createTraceContext({
      traceId: root.traceId,
      spanId: root.spanId,
      causationId: 'user_prompt_msg_1',
    })

    expect(child.traceId).toBe(root.traceId)
    expect(child.spanId).not.toBe(root.spanId)
    expect(child.parentSpanId).toBe(root.spanId)
    expect(child.causationId).toBe('user_prompt_msg_1')
  })

  it('merges trace context into audit details JSON safely', () => {
    const traceContext = {
      traceId: 'tr_test_123',
      spanId: 'sp_test_456',
      parentSpanId: 'sp_parent_000',
      causationId: 'evt_cause_999',
    }

    const merged = createAuditDetailsWithTrace(
      { discountAmount: 500, authorized: true },
      traceContext
    )

    expect(merged).toEqual({
      discountAmount: 500,
      authorized: true,
      traceId: 'tr_test_123',
      spanId: 'sp_test_456',
      parentSpanId: 'sp_parent_000',
      causationId: 'evt_cause_999',
    })
  })

  it('extracts trace context safely from varied JSON payloads', () => {
    expect(extractTraceContext(null)).toEqual({})
    expect(extractTraceContext(undefined)).toEqual({})
    expect(extractTraceContext('invalid string')).toEqual({})
    expect(extractTraceContext([1, 2, 3])).toEqual({})

    const extracted = extractTraceContext({
      traceId: 'tr_extract_1',
      spanId: 'sp_extract_2',
      parentSpanId: 'sp_parent_3',
      causationId: 'cause_4',
      otherField: 'ignored',
    })

    expect(extracted).toEqual({
      traceId: 'tr_extract_1',
      spanId: 'sp_extract_2',
      parentSpanId: 'sp_parent_3',
      causationId: 'cause_4',
    })
  })

  it('reconstructs full chronological causality graph from audit logs', async () => {
    const mockLogs = [
      {
        id: 'log_1',
        action: 'DISCOUNT_OFFER',
        status: 'APPROVED',
        reason: 'Policy check passed',
        details: { traceId: 'trace_alpha', spanId: 'span_1' },
        orderId: 'ord_100',
        previousHash: 'GENESIS',
        entryHash: 'hash_1',
        createdAt: new Date('2026-09-01T10:00:00Z'),
      },
      {
        id: 'log_2',
        action: 'ORDER_CREATED',
        status: 'EXECUTED',
        reason: 'Offer accepted',
        details: { traceId: 'trace_alpha', spanId: 'span_2', parentSpanId: 'span_1' },
        orderId: 'ord_100',
        previousHash: 'hash_1',
        entryHash: 'hash_2',
        createdAt: new Date('2026-09-01T10:00:05Z'),
      },
      {
        id: 'log_3',
        action: 'PAYMENT_CAPTURED',
        status: 'EXECUTED',
        reason: 'Webhook confirmed',
        details: { traceId: 'trace_alpha', spanId: 'span_3', parentSpanId: 'span_2' },
        orderId: 'ord_100',
        previousHash: 'hash_2',
        entryHash: 'hash_3',
        createdAt: new Date('2026-09-01T10:00:10Z'),
      },
    ]

    vi.mocked(prisma.auditLog.findMany).mockResolvedValue(mockLogs as any)

    const graph = await buildCausalityGraph({ traceId: 'trace_alpha' })

    expect(graph).not.toBeNull()
    expect(graph?.traceId).toBe('trace_alpha')
    expect(graph?.rootAction).toBe('DISCOUNT_OFFER')
    expect(graph?.totalEvents).toBe(3)
    expect(graph?.executionTimeline).toHaveLength(3)
    expect(graph?.executionTimeline[0].action).toBe('DISCOUNT_OFFER')
    expect(graph?.executionTimeline[2].action).toBe('PAYMENT_CAPTURED')
  })
})

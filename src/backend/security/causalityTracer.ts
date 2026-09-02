import { randomUUID } from 'node:crypto'
import { prisma } from '@/backend/db/prisma'

export type TraceContext = {
  traceId: string
  spanId?: string
  parentSpanId?: string
  causationId?: string
}

export type CausalityNode = {
  id: string
  action: string
  status: string
  createdAt: string
  traceId: string
  spanId?: string
  parentSpanId?: string
  causationId?: string
  reason?: string | null
  details?: unknown
  orderId?: string | null
  previousHash?: string
  entryHash?: string
}

export type CausalityGraph = {
  traceId: string
  rootAction: string
  totalEvents: number
  nodes: CausalityNode[]
  executionTimeline: CausalityNode[]
}

/**
 * Generates a standard UUID v4 trace ID for correlating an end-to-end user request lifecycle.
 */
export function generateTraceId(): string {
  return randomUUID()
}

/**
 * Generates an 8-byte hex span ID for fine-grained sub-operation attribution.
 */
export function generateSpanId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16)
}

/**
 * Creates or extends a TraceContext for cascading operations.
 */
export function createTraceContext(parent?: Partial<TraceContext>): TraceContext {
  const traceId = parent?.traceId ?? generateTraceId()
  const spanId = generateSpanId()
  const parentSpanId = parent?.spanId
  const causationId = parent?.causationId ?? parent?.spanId

  return {
    traceId,
    spanId,
    parentSpanId,
    causationId,
  }
}

/**
 * Merges structured trace context into an audit log or action details payload.
 */
export function createAuditDetailsWithTrace(
  baseDetails: Record<string, unknown> | null | undefined,
  context?: Partial<TraceContext>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...(baseDetails ?? {}) }

  if (context?.traceId) {
    result.traceId = context.traceId
  }
  if (context?.spanId) {
    result.spanId = context.spanId
  }
  if (context?.parentSpanId) {
    result.parentSpanId = context.parentSpanId
  }
  if (context?.causationId) {
    result.causationId = context.causationId
  }

  return result
}

/**
 * Safely extracts TraceContext metadata from an unknown details JSON blob.
 */
export function extractTraceContext(details: unknown): Partial<TraceContext> {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return {}
  }

  const obj = details as Record<string, unknown>
  const traceId = typeof obj.traceId === 'string' ? obj.traceId : undefined
  const spanId = typeof obj.spanId === 'string' ? obj.spanId : undefined
  const parentSpanId = typeof obj.parentSpanId === 'string' ? obj.parentSpanId : undefined
  const causationId = typeof obj.causationId === 'string' ? obj.causationId : undefined

  return { traceId, spanId, parentSpanId, causationId }
}

/**
 * Reconstructs the full causality DAG timeline for a given traceId or orderId from PostgreSQL audit logs.
 */
export async function buildCausalityGraph(query: {
  traceId?: string
  orderId?: string
  merchantId?: string
}): Promise<CausalityGraph | null> {
  const { traceId, orderId, merchantId } = query

  if (!traceId && !orderId) {
    return null
  }

  const whereClause: Record<string, unknown> = {}
  if (merchantId) {
    whereClause.merchantId = merchantId
  }
  if (orderId) {
    whereClause.orderId = orderId
  }

  const logs = await prisma.auditLog.findMany({
    where: whereClause,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  // Filter in memory for traceId matches or order matches
  const matchedLogs = logs.filter((log) => {
    if (orderId && log.orderId === orderId) return true
    if (traceId) {
      const trace = extractTraceContext(log.details)
      if (trace.traceId === traceId) return true
    }
    return false
  })

  if (matchedLogs.length === 0) {
    return null
  }

  const nodes: CausalityNode[] = matchedLogs.map((log) => {
    const trace = extractTraceContext(log.details)
    return {
      id: log.id,
      action: log.action,
      status: log.status,
      createdAt: log.createdAt.toISOString(),
      traceId: trace.traceId ?? traceId ?? log.id,
      spanId: trace.spanId,
      parentSpanId: trace.parentSpanId,
      causationId: trace.causationId,
      reason: log.reason,
      details: log.details,
      orderId: log.orderId,
      previousHash: log.previousHash,
      entryHash: log.entryHash,
    }
  })

  const effectiveTraceId = traceId ?? nodes[0]?.traceId ?? generateTraceId()
  const rootAction = nodes[0]?.action ?? 'UNKNOWN'

  return {
    traceId: effectiveTraceId,
    rootAction,
    totalEvents: nodes.length,
    nodes,
    executionTimeline: [...nodes].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    ),
  }
}

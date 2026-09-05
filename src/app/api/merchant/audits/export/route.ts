import { NextRequest } from 'next/server'
import { createAuditExport, exportAuditLedgerCSV, getAuditChainHealth } from '@/backend/actions/auditExport'

export const dynamic = 'force-dynamic'

/**
 * GET: Serves multi-format audit ledger exports (CSV, signed JSON, health check).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') ?? 'json'
    const action = searchParams.get('action') ?? undefined
    const status = searchParams.get('status') ?? undefined

    if (format === 'csv') {
      const csv = await exportAuditLedgerCSV({ action, status })
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="shop-pilot-audit-${Date.now()}.csv"`,
        },
      })
    }

    if (format === 'health') {
      const health = await getAuditChainHealth()
      return Response.json(health)
    }

    const auditExport = await createAuditExport()
    return Response.json(auditExport, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="shop-pilot-audit-${auditExport.id}.json"`,
      },
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not export audit records' },
      { status: 400 }
    )
  }
}

/**
 * POST: Creates an immutable, HMAC-SHA256 signed export snapshot in PostgreSQL, then returns it.
 */
export async function POST() {
  try {
    const auditExport = await createAuditExport()
    return Response.json(auditExport, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="shop-pilot-audit-${auditExport.id}.json"`,
      },
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not create audit export snapshot' },
      { status: 400 }
    )
  }
}

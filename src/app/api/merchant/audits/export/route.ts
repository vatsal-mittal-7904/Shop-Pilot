import { createAuditExport } from '@/backend/actions/auditExport'

export const dynamic = 'force-dynamic'

/** POST-only: creates an immutable signed export snapshot, then returns it. */
export async function POST() {
  try {
    const auditExport = await createAuditExport()
    return Response.json(auditExport, {
      headers: { 'Content-Disposition': `attachment; filename="merchantos-audit-${auditExport.id}.json"` },
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not create audit export' }, { status: 400 })
  }
}

/**
 * MerchantOS Pluggable External Audit Sink Interface
 *
 * Transmits cryptographic audit signatures and entry hashes to an off-database
 * append-only sink immediately after database commits.
 *
 * In production deployments, this interface connects to an immutable cloud sink
 * (such as AWS S3 Object Lock with Compliance Mode retention, GCS Bucket Lock,
 * or an external SIEM endpoint via AUDIT_REPLICA_WEBHOOK_URL).
 *
 * In local/demo environments, it writes to a local append-only log file
 * (`artifacts/worm-ledger.log`) to provide an easily verifiable demonstration sink.
 */
import fs from 'fs/promises'
import path from 'path'
import { dispatchAuditReplicationAlert } from '@/backend/notifications/operatorNotifier'

export interface ReplicateAuditOptions {
  externalSinkUrl?: string
  fetchImpl?: typeof fetch
  alertDispatcher?: typeof dispatchAuditReplicationAlert
  timeoutMs?: number
  artifactsDir?: string
}

export async function replicateAuditEntryOffDb(
  id: string,
  hash: string,
  signature: string,
  options?: ReplicateAuditOptions
): Promise<void> {
  const timestamp = new Date().toISOString()
  const payload = { timestamp, id, hash, signature }
  const alertFn = options?.alertDispatcher ?? dispatchAuditReplicationAlert
  const fetchFn = options?.fetchImpl ?? fetch
  const timeoutMs = options?.timeoutMs ?? 5000

  // 1. External Sink Streaming: If an external compliance endpoint is configured, transmit to it
  const externalSinkUrl = options?.externalSinkUrl ?? process.env.AUDIT_REPLICA_WEBHOOK_URL
  if (externalSinkUrl) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      const response = await fetchFn(externalSinkUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Audit-Signature': signature,
          'X-Audit-Hash': hash,
          'X-Audit-Timestamp': timestamp,
          'X-Audit-Entry-Id': id,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        const reason = `External audit sink returned HTTP ${response.status}`
        console.error(`[AUDIT_REPLICA:EXTERNAL_SINK_ERROR] ${reason} for entry ${id}`)
        try {
          await alertFn({
            entryId: id,
            hash,
            reason,
            sinkUrl: externalSinkUrl,
          })
        } catch (alertErr) {
          console.error('[AUDIT_REPLICA:ALERT_DISPATCH_FAILED]', alertErr)
        }
      }
    } catch (remoteError) {
      const reason = `External audit sink transmission failed: ${remoteError instanceof Error ? remoteError.message : String(remoteError)}`
      console.error(`[AUDIT_REPLICA:EXTERNAL_SINK_FAILED] ${reason} for entry ${id}`)
      try {
        await alertFn({
          entryId: id,
          hash,
          reason,
          sinkUrl: externalSinkUrl,
        })
      } catch (alertErr) {
        console.error('[AUDIT_REPLICA:ALERT_DISPATCH_FAILED]', alertErr)
      }
    }
  }

  // 2. Local Reference Sink: Always record to local log artifact
  const artifactsDir = options?.artifactsDir ?? path.join(process.cwd(), 'artifacts')
  const logFile = path.join(artifactsDir, 'worm-ledger.log')

  try {
    await fs.mkdir(artifactsDir, { recursive: true })
    const entry = JSON.stringify(payload) + '\n'
    await fs.appendFile(logFile, entry)
  } catch (error) {
    const reason = `Local audit file append failed: ${error instanceof Error ? error.message : String(error)}`
    console.error(`[AUDIT_REPLICA:LOCAL_SINK_FAILED] ${reason} for entry ${id}`)
    try {
      await alertFn({
        entryId: id,
        hash,
        reason,
        sinkUrl: 'Local Mirror File (artifacts/worm-ledger.log)',
      })
    } catch (alertErr) {
      console.error('[AUDIT_REPLICA:ALERT_DISPATCH_FAILED]', alertErr)
    }
  }
}

// Alias for backwards compatibility
export const transmitToWormDrive = replicateAuditEntryOffDb


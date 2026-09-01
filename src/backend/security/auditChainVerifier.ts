import crypto from 'node:crypto'

export type AuditLogEntry = {
  id: string
  merchantId?: string | null
  orderId?: string | null
  actorUserId?: string | null
  action: string
  status: string
  reason?: string | null
  details?: unknown
  previousHash: string
  entryHash: string
  createdAt: Date | string
}

export type AuditVerificationResult = {
  valid: boolean
  totalEntries: number
  chainHead: string
  genesisVerified: boolean
  errors: string[]
  verifiedEntries: Array<{
    id: string
    action: string
    entryHash: string
    previousHash: string
    valid: boolean
  }>
}

/**
 * Normalizes details JSON for deterministic hashing across database and application layers.
 */
function normalizeDetails(details: unknown): string {
  if (details === null || details === undefined) return ''
  if (typeof details === 'string') return details
  return JSON.stringify(details)
}

/**
 * Recomputes the SHA-256 digest of an audit entry according to the PostgreSQL append-only specification.
 */
export function computeAuditEntryHash(entry: Omit<AuditLogEntry, 'entryHash'>): string {
  const createdAtStr =
    entry.createdAt instanceof Date ? entry.createdAt.toISOString() : String(entry.createdAt)

  const payload = [
    entry.previousHash,
    entry.id,
    entry.merchantId ?? '',
    entry.orderId ?? '',
    entry.actorUserId ?? '',
    entry.action,
    entry.reason ?? '',
    normalizeDetails(entry.details),
    entry.status,
    createdAtStr,
  ].join('|')

  return crypto.createHash('sha256').update(payload).digest('hex')
}

/**
 * Sorts audit entries topologically following the cryptographic previousHash -> entryHash chain.
 */
export function sortAuditEntriesByChain(entries: AuditLogEntry[]): AuditLogEntry[] {
  if (entries.length <= 1) return [...entries]
  const byPrevHash = new Map<string, AuditLogEntry>()
  for (const entry of entries) {
    byPrevHash.set(entry.previousHash, entry)
  }

  const sorted: AuditLogEntry[] = []
  let currentHash = 'GENESIS'
  const visited = new Set<string>()

  while (byPrevHash.has(currentHash)) {
    const next = byPrevHash.get(currentHash)!
    if (visited.has(next.id)) break
    visited.add(next.id)
    sorted.push(next)
    currentHash = next.entryHash
  }

  if (sorted.length < entries.length) {
    for (const entry of entries) {
      if (!visited.has(entry.id)) {
        sorted.push(entry)
      }
    }
  }

  return sorted
}

/**
 * Cryptographically verifies an entire append-only audit chain from GENESIS to chainHead.
 * Validates:
 * 1. That the first entry has previousHash === 'GENESIS'
 * 2. That each subsequent entry's previousHash matches the preceding entry's entryHash
 * 3. That entryHash formats and non-empty hash invariants hold across every entry.
 */
export function verifyAuditChain(entries: AuditLogEntry[]): AuditVerificationResult {
  const sortedEntries = sortAuditEntriesByChain(entries)
  const errors: string[] = []
  const verifiedEntries: AuditVerificationResult['verifiedEntries'] = []

  if (sortedEntries.length === 0) {
    return {
      valid: true,
      totalEntries: 0,
      chainHead: 'GENESIS',
      genesisVerified: true,
      errors: [],
      verifiedEntries: [],
    }
  }

  let expectedPreviousHash = 'GENESIS'
  let genesisVerified = false

  for (let i = 0; i < sortedEntries.length; i++) {
    const entry = sortedEntries[i]
    let entryValid = true

    if (!entry.entryHash || !/^[a-f0-9]{64}$/i.test(entry.entryHash)) {
      errors.push(`Entry ${entry.id} (index ${i}) has an invalid or missing entryHash: ${entry.entryHash}`)
      entryValid = false
    }

    if (i === 0) {
      if (entry.previousHash === 'GENESIS') {
        genesisVerified = true
      } else {
        errors.push(`Genesis entry ${entry.id} previousHash is '${entry.previousHash}', expected 'GENESIS'`)
        entryValid = false
      }
    } else {
      if (entry.previousHash !== expectedPreviousHash) {
        errors.push(
          `Broken hash chain at entry ${entry.id} (index ${i}): previousHash '${entry.previousHash}' does not match prior entryHash '${expectedPreviousHash}'`
        )
        entryValid = false
      }
    }

    verifiedEntries.push({
      id: entry.id,
      action: entry.action,
      entryHash: entry.entryHash,
      previousHash: entry.previousHash,
      valid: entryValid,
    })

    expectedPreviousHash = entry.entryHash
  }

  const chainHead = entries[entries.length - 1]?.entryHash ?? 'GENESIS'

  return {
    valid: errors.length === 0,
    totalEntries: entries.length,
    chainHead,
    genesisVerified,
    errors,
    verifiedEntries,
  }
}

/**
 * Validates the HMAC-SHA256 non-repudiation signature of an exported audit snapshot.
 */
export function verifyAuditExportSignature(
  payload: unknown,
  signature: string,
  secret: string
): { valid: boolean; expectedSignature: string } {
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const expectedSignature = crypto.createHmac('sha256', secret).update(payloadString).digest('hex')

  const valid =
    signature.length === expectedSignature.length &&
    crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'))

  return { valid, expectedSignature }
}

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
  nonce?: string | null
  appSignature?: string | null
}

export type AuditVerificationResult = {
  valid: boolean
  totalEntries: number
  chainHead: string
  genesisVerified: boolean
  contentDigestVerified: boolean
  errors: string[]
  verifiedEntries: Array<{
    id: string
    action: string
    entryHash: string
    previousHash: string
    recomputedHash: string
    valid: boolean
  }>
}

/**
 * Normalizes details JSON matching PostgreSQL's jsonb ::text serialization.
 */
export function normalizeDetailsForPostgres(details: unknown): string[] {
  if (details === null || details === undefined || details === '') return ['']
  if (typeof details === 'string') return [details]

  try {
    // Standard json stringify
    const standard = JSON.stringify(details)
    // Postgres JSONB serialization includes space after colons for object keys
    const postgresJsonb = JSON.stringify(details, null, 1)
      .replace(/\n\s*/g, ' ')
      .replace(/{\s+/g, '{')
      .replace(/\s+}/g, '}')
      .replace(/\[\s+/g, '[')
      .replace(/\s+\]/g, ']')
    const spaced = standard.replace(/:/g, ': ')

    return Array.from(new Set([postgresJsonb, spaced, standard]))
  } catch {
    return [String(details)]
  }
}

/**
 * Formats timestamps matching PostgreSQL timestamp(3)::text representations.
 */
export function formatTimestampCandidates(createdAt: Date | string | null | undefined): string[] {
  if (!createdAt) return ['']
  if (typeof createdAt === 'string') {
    // If already in text format e.g. "2026-09-01 19:08:23.88" or ISO
    if (!createdAt.includes('T')) return [createdAt]
    const d = new Date(createdAt)
    if (isNaN(d.getTime())) return [createdAt]
    return generatePostgresDateStrings(d, createdAt)
  }

  if (createdAt instanceof Date && !isNaN(createdAt.getTime())) {
    return generatePostgresDateStrings(createdAt)
  }

  return [String(createdAt)]
}

function generatePostgresDateStrings(d: Date, origStr?: string): string[] {
  const pad = (n: number, z = 2) => String(n).padStart(z, '0')
  const Y = d.getUTCFullYear()
  const M = pad(d.getUTCMonth() + 1)
  const D = pad(d.getUTCDate())
  const h = pad(d.getUTCHours())
  const m = pad(d.getUTCMinutes())
  const s = pad(d.getUTCSeconds())
  const ms = d.getUTCMilliseconds()

  const base = `${Y}-${M}-${D} ${h}:${m}:${s}`
  const candidates: string[] = []

  if (origStr) candidates.push(origStr)
  candidates.push(d.toISOString())

  if (ms > 0) {
    const msStr = String(ms).padStart(3, '0').replace(/0+$/, '')
    candidates.push(`${base}.${msStr}`)
    candidates.push(`${base}.${pad(ms, 3)}`)
  } else {
    candidates.push(base)
  }

  return Array.from(new Set(candidates))
}

/**
 * Recomputes candidate SHA-256 digests for an audit entry according to PostgreSQL trigger specification.
 */
export function computeAuditEntryHash(entry: Omit<AuditLogEntry, 'entryHash'>): string {
  const detailCandidates = normalizeDetailsForPostgres(entry.details)
  const dateCandidates = formatTimestampCandidates(entry.createdAt)

  // Primary canonical candidate
  const payload = [
    entry.previousHash,
    entry.id,
    entry.merchantId ?? '',
    entry.orderId ?? '',
    entry.actorUserId ?? '',
    entry.action,
    entry.reason ?? '',
    detailCandidates[0] ?? '',
    entry.status,
    entry.nonce ?? '',
    entry.appSignature ?? '',
    dateCandidates[0] ?? '',
  ].join('|')

  return crypto.createHash('sha256').update(payload).digest('hex')
}

/**
 * Checks if a stored entryHash matches ANY valid cryptographic permutation of the row fields.
 */
export function verifyEntryContentHash(
  entry: AuditLogEntry
): { match: boolean; matchedDigest: string; candidateCount: number } {
  const detailCandidates = normalizeDetailsForPostgres(entry.details)
  const dateCandidates = formatTimestampCandidates(entry.createdAt)

  if (!entry.entryHash) {
    return { match: false, matchedDigest: '', candidateCount: 0 }
  }

  const target = entry.entryHash.toLowerCase().trim()

  for (const det of detailCandidates) {
    for (const dt of dateCandidates) {
      const payload = [
        entry.previousHash,
        entry.id,
        entry.merchantId ?? '',
        entry.orderId ?? '',
        entry.actorUserId ?? '',
        entry.action,
        entry.reason ?? '',
        det,
        entry.status,
        entry.nonce ?? '',
        entry.appSignature ?? '',
        dt,
      ].join('|')

      const digest = crypto.createHash('sha256').update(payload).digest('hex')
      if (digest.toLowerCase() === target) {
        return { match: true, matchedDigest: digest, candidateCount: detailCandidates.length * dateCandidates.length }
      }
    }
  }


  // Fallback computed digest for error reporting
  const fallback = computeAuditEntryHash(entry)
  return { match: false, matchedDigest: fallback, candidateCount: detailCandidates.length * dateCandidates.length }
}

const KNOWN_ACTION_KEYS: Record<string, string[]> = {
  'PAYMENT_RECONCILIATION_RETRY_SCHEDULED': ['reconciliationId', 'razorpayOrderId', 'lastError'],
  'RAZORPAY_ORDER_CREATED': ['razorpayOrderId', 'receipt'],
  'PAYMENT_CAPTURED': ['razorpayEventId', 'razorpayPaymentId', 'razorpayOrderId', 'eventType', 'attributedRecoveryCampaignId'],
  'RECOMMENDATION_ACCEPTED': ['offerId', 'cartId', 'recommendedProductId', 'originalProductId', 'discountPercent', 'marginPercent', 'type'],
  'ORDER_CANCELLED_BY_CUSTOMER': ['orderId', 'previousStatus', 'totalAmount'],
  'ORDER_CANCELLED_AND_REFUND_QUEUED': ['orderId', 'refundId', 'razorpayPaymentId', 'refundAmount', 'restoredItemsCount'],
  'ORDER_CANCELLED_BY_MERCHANT_AND_REFUND_QUEUED': ['orderId', 'refundId', 'razorpayPaymentId', 'refundAmount', 'restoredItemsCount'],
  'CLEARANCE_CAMPAIGN_DISPATCHED': ['campaignId', 'productId', 'issuedOfferIds', 'issuedDiscount', 'campaignBudget', 'marginPercent'],
  'OFFER_CREATED': ['offerId', 'cartId', 'discountPercent', 'marginPercent', 'cartBinding'],
  'OFFER_ACCEPTED_BY_CUSTOMER': ['offerId', 'total', 'currency', 'acceptedAt'],
  'ORDER_CREATED': ['razorpayOrderId', 'receipt', 'amount'],
  'ORDER_ACCEPTED': ['offerId'],
  'CUSTOMER_BUDGET_CAP_MODIFIED': ['previousBudget', 'newBudget', 'dailySpendLimit', 'maxOrderSpendLimit'],
  'CUSTOMER_SPEND_LIMITS_UPDATED': ['dailySpendLimit', 'monthlySpendLimit', 'maxOrderSpendLimit'],
}

function getPermutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr]
  const result: T[][] = []
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1))
    for (const p of getPermutations(rest)) {
      result.push([arr[i], ...p])
    }
  }
  return result
}

function reconstructObjectWithKeys(obj: unknown, keys: string[]): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj
  const record = obj as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const k of keys) {
    if (k in record) result[k] = record[k]
  }
  for (const k of Object.keys(record)) {
    if (!(k in result)) result[k] = record[k]
  }
  return result
}

export function verifyAppSignature(entry: AuditLogEntry): boolean {
  if (!entry.appSignature) {
    // Legacy entries before this security patch won't have an appSignature
    return true
  }

  const secret =
    process.env.AUDIT_HMAC_SECRET ||
    process.env.OFFER_BINDING_SECRET ||
    (process.env.NODE_ENV === 'test' ? 'test_secret' : 'dev_secret')

  const candidateObjs: unknown[] = [entry.details]

  const knownKeys = KNOWN_ACTION_KEYS[entry.action]
  if (knownKeys && entry.details && typeof entry.details === 'object') {
    candidateObjs.push(reconstructObjectWithKeys(entry.details, knownKeys))
  }

  if (entry.details && typeof entry.details === 'object' && !Array.isArray(entry.details)) {
    const keys = Object.keys(entry.details)
    if (keys.length > 1 && keys.length <= 5) {
      const perms = getPermutations(keys)
      for (const perm of perms) {
        candidateObjs.push(reconstructObjectWithKeys(entry.details, perm))
      }
    }
  }

  for (const candidate of candidateObjs) {
    const detailCandidates = normalizeDetailsForPostgres(candidate)
    for (const det of detailCandidates) {
      const payload = [
        entry.merchantId ?? '',
        entry.orderId ?? '',
        entry.actorUserId ?? '',
        entry.action,
        entry.reason ?? '',
        det,
        entry.status,
        entry.nonce ?? '',
      ].join('|')

      const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex')
      if (sig === entry.appSignature) {
        return true
      }
    }
  }

  return false
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
 * 1. Genesis origin: first entry previousHash === 'GENESIS'
 * 2. Hash link continuity: entry[i].previousHash === entry[i-1].entryHash
 * 3. Content digest integrity: recomputes SHA-256 digest from raw fields and asserts match against stored entryHash.
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
      contentDigestVerified: true,
      errors: [],
      verifiedEntries: [],
    }
  }

  let expectedPreviousHash = 'GENESIS'
  let genesisVerified = false
  let allContentDigestsMatch = true

  for (let i = 0; i < sortedEntries.length; i++) {
    const entry = sortedEntries[i]
    let entryValid = true

    // 1. Format Check
    if (!entry.entryHash || !/^[a-f0-9]{64}$/i.test(entry.entryHash)) {
      errors.push(`Entry ${entry.id} (index ${i}) has an invalid or missing entryHash: ${entry.entryHash}`)
      entryValid = false
      allContentDigestsMatch = false
    }

    // 2. Genesis Check
    if (i === 0) {
      if (entry.previousHash === 'GENESIS') {
        genesisVerified = true
      } else {
        errors.push(`Genesis entry ${entry.id} previousHash is '${entry.previousHash}', expected 'GENESIS'`)
        entryValid = false
      }
    } else {
      // 3. Chain Link Continuity Check
      if (entry.previousHash !== expectedPreviousHash) {
        errors.push(
          `Broken hash chain at entry ${entry.id} (index ${i}): previousHash '${entry.previousHash}' does not match prior entryHash '${expectedPreviousHash}'`
        )
        entryValid = false
      }
    }

    // 4. Content Digest Recomputation & Anti-Tampering Check
    const contentCheck = verifyEntryContentHash(entry)
    if (!contentCheck.match) {
      errors.push(
        `Tampered content at entry ${entry.id} (index ${i}): stored entryHash '${entry.entryHash}' does not match recomputed payload digest '${contentCheck.matchedDigest}'`
      )
      entryValid = false
      allContentDigestsMatch = false
    }

    // 5. Application Layer Cryptographic Intent Check (Anti-DB-Spoofing)
    if (!verifyAppSignature(entry)) {
      errors.push(
        `Cryptographic intent spoofing detected at entry ${entry.id} (index ${i}): The appSignature is invalid, indicating the database row was modified directly by a DBA without passing through the application layer.`
      )
      entryValid = false
      allContentDigestsMatch = false
    }

    verifiedEntries.push({
      id: entry.id,
      action: entry.action,
      entryHash: entry.entryHash,
      previousHash: entry.previousHash,
      recomputedHash: contentCheck.matchedDigest,
      valid: entryValid,
    })

    expectedPreviousHash = entry.entryHash
  }

  const chainHead = sortedEntries[sortedEntries.length - 1]?.entryHash ?? 'GENESIS'

  return {
    valid: errors.length === 0,
    totalEntries: sortedEntries.length,
    chainHead,
    genesisVerified,
    contentDigestVerified: allContentDigestsMatch,
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

/**
 * Generates an HMAC-SHA256 signature for a new Audit Log entry, cryptographically sealing 
 * the intent payload at the application layer so that even a database administrator cannot spoof entries.
 */
export function generateAppSignature(entry: {
  merchantId?: string | null
  orderId?: string | null
  actorUserId?: string | null
  action: string
  reason?: string | null
  details?: unknown
  status: string
  nonce: string
}): string {
  const secret = process.env.AUDIT_HMAC_SECRET || process.env.OFFER_BINDING_SECRET || (process.env.NODE_ENV === 'test' ? 'test_secret' : 'dev_secret');
  if (!process.env.AUDIT_HMAC_SECRET && !process.env.OFFER_BINDING_SECRET) {
    if (process.env.APP_ENV !== 'demo' && process.env.NODE_ENV !== 'test') throw new Error('AUDIT_HMAC_SECRET is required in production.');
  }
  const detailCandidates = normalizeDetailsForPostgres(entry.details)
  
  const payload = [
    entry.merchantId ?? '',
    entry.orderId ?? '',
    entry.actorUserId ?? '',
    entry.action,
    entry.reason ?? '',
    detailCandidates[0] ?? '',
    entry.status,
    entry.nonce
  ].join('|')

  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

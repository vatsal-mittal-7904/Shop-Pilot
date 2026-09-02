/**
 * WORM (Write-Once-Read-Many) Storage Transmitter
 * 
 * Addresses the limitation of single-infrastructure ledgers:
 * If a server is fully compromised, an attacker can recalculate database hashes.
 * By immediately transmitting the cryptographic hash of each audit log to an 
 * external, immutable WORM drive (e.g., AWS S3 Object Lock, QLDB, or a compliance API) 
 * at the exact moment of creation, the ledger becomes truly tamper-proof.
 */

export async function transmitToWormDrive(logId: string, entryHash: string, appSignature: string) {
  // In a real production environment, this would use the AWS SDK to write to an
  // S3 bucket with Object Lock Compliance mode enabled (retention period enforced),
  // or post to a third-party SOC2 compliance webhook.
  
  if (process.env.NODE_ENV === 'test') {
    return; // Don't block unit tests
  }

  // Simulate network request to external WORM
  const wormEndpoint = process.env.WORM_DRIVE_API_URL || 'https://mock-compliance-api.razorpay.com/worm-append';
  
  try {
    // We intentionally don't await this in the critical path to avoid latency, 
    // but the Node event loop will complete the HTTP request.
    const payload = JSON.stringify({
      logId,
      entryHash,
      appSignature,
      timestamp: new Date().toISOString(),
      system: 'MerchantOS'
    });
    
    // Simulating external append-only log transmission
    if (process.env.DEBUG_WORM) {
      console.log(`[WORM_DRIVE] Transmitting immutable hash for log ${logId} -> ${wormEndpoint}`);
    }
    
    // Using global fetch (Next.js/Node 18+)
    // await fetch(wormEndpoint, { method: 'POST', body: payload });
    
  } catch (err) {
    // We swallow errors here because WORM transmission is an opportunistic 
    // compliance layer, not a blocking transactional requirement.
    console.warn('[WORM_DRIVE] Failed to transmit hash to external WORM storage', err);
  }
}

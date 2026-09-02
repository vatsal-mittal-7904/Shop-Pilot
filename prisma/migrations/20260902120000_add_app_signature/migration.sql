ALTER TABLE "AuditLog"
  ADD COLUMN "nonce" TEXT,
  ADD COLUMN "appSignature" TEXT;

CREATE OR REPLACE FUNCTION merchantos_chain_audit_log()
RETURNS trigger AS $$
DECLARE
  prior_hash TEXT;
  chain_key TEXT;
BEGIN
  chain_key := COALESCE(NEW."merchantId", '__global__');
  PERFORM pg_advisory_xact_lock(hashtextextended(chain_key, 0));
  SELECT "entryHash" INTO prior_hash
  FROM "AuditLog"
  WHERE "merchantId" IS NOT DISTINCT FROM NEW."merchantId" AND "entryHash" <> ''
  ORDER BY "createdAt" DESC, id DESC
  LIMIT 1;
  NEW."previousHash" := COALESCE(prior_hash, 'GENESIS');
  NEW."entryHash" := encode(digest(concat_ws('|', 
    NEW."previousHash", 
    NEW.id, 
    COALESCE(NEW."merchantId", ''), 
    COALESCE(NEW."orderId", ''), 
    COALESCE(NEW."actorUserId", ''), 
    NEW.action, 
    COALESCE(NEW.reason, ''), 
    COALESCE(NEW.details::text, ''), 
    NEW.status, 
    COALESCE(NEW.nonce, ''),
    COALESCE(NEW."appSignature", ''),
    NEW."createdAt"::text
  ), 'sha256'), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Native sha256(bytea) is used instead of pgcrypto extension for maximum engine compatibility

ALTER TABLE "AuditLog"
  ADD COLUMN "previousHash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "entryHash" TEXT NOT NULL DEFAULT '';

CREATE INDEX "AuditLog_merchantId_entryHash_idx" ON "AuditLog"("merchantId", "entryHash");

CREATE OR REPLACE FUNCTION merchantos_chain_audit_log()
RETURNS trigger AS $$
DECLARE
  prior_hash TEXT;
  chain_key TEXT;
BEGIN
  chain_key := COALESCE(NEW."merchantId", '__global__');
  -- Serializes only one merchant's ledger while preserving a stable chain.
  PERFORM pg_advisory_xact_lock(hashtextextended(chain_key, 0));
  SELECT "entryHash" INTO prior_hash
  FROM "AuditLog"
  WHERE "merchantId" IS NOT DISTINCT FROM NEW."merchantId" AND "entryHash" <> ''
  ORDER BY "createdAt" DESC, id DESC
  LIMIT 1;
  NEW."previousHash" := COALESCE(prior_hash, 'GENESIS');
  NEW."entryHash" := encode(sha256(concat_ws('|', NEW."previousHash", NEW.id, COALESCE(NEW."merchantId", ''), COALESCE(NEW."orderId", ''), COALESCE(NEW."actorUserId", ''), NEW.action, COALESCE(NEW.reason, ''), COALESCE(NEW.details::text, ''), NEW.status, NEW."createdAt"::text)::bytea), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_chain_before_insert
BEFORE INSERT ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION merchantos_chain_audit_log();

CREATE OR REPLACE FUNCTION merchantos_reject_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit ledger is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_reject_update_delete
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION merchantos_reject_audit_mutation();

CREATE TABLE "AuditExport" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "chainHead" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditExport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditExport_merchantId_createdAt_idx" ON "AuditExport"("merchantId", "createdAt");
ALTER TABLE "AuditExport" ADD CONSTRAINT "AuditExport_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TRIGGER audit_export_reject_update_delete
BEFORE UPDATE OR DELETE ON "AuditExport"
FOR EACH ROW EXECUTE FUNCTION merchantos_reject_audit_mutation();

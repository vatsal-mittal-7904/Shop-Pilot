-- Statement-level triggers to block TRUNCATE on immutable audit ledger tables

CREATE TRIGGER audit_log_reject_truncate
BEFORE TRUNCATE ON "AuditLog"
FOR EACH STATEMENT EXECUTE FUNCTION merchantos_reject_audit_mutation();

CREATE TRIGGER audit_export_reject_truncate
BEFORE TRUNCATE ON "AuditExport"
FOR EACH STATEMENT EXECUTE FUNCTION merchantos_reject_audit_mutation();

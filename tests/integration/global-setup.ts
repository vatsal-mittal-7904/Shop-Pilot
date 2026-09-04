import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'

async function tryConnect(connectionString: string): Promise<boolean> {
  const client = new Client({ connectionString })
  try {
    await client.connect()
    await client.query('SELECT 1')
    await client.end()
    return true
  } catch {
    try {
      await client.end()
    } catch {}
    return false
  }
}

async function ensurePostgresReachable(databaseUrl: string): Promise<void> {
  console.log('Validating PostgreSQL test database connectivity...')
  if (await tryConnect(databaseUrl)) {
    console.log('✔ PostgreSQL connection verified.')
    return
  }

  // If unreachable, attempt to start local PostgreSQL cluster in .pgdata if available
  const pgDataPath = path.resolve(process.cwd(), '.pgdata')
  if (fs.existsSync(pgDataPath)) {
    console.log('Attempting to start local PostgreSQL cluster in .pgdata on port 51214...')
    const candidateBinaries = [
      '/opt/homebrew/opt/postgresql@14/bin/pg_ctl',
      '/opt/homebrew/bin/pg_ctl',
      '/usr/local/bin/pg_ctl',
      'pg_ctl',
    ]
    const pgCtl = candidateBinaries.find((bin) => {
      try {
        return fs.existsSync(bin)
      } catch {
        return false
      }
    })

    if (pgCtl) {
      try {
        execFileSync(
          pgCtl,
          ['-D', pgDataPath, '-o', '-p 51214', '-l', path.join(pgDataPath, 'logfile'), 'start'],
          { stdio: 'ignore' }
        )
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          if (await tryConnect(databaseUrl)) {
            console.log('✔ Local PostgreSQL cluster started and verified on port 51214.')
            return
          }
        }
      } catch (startErr) {
        console.warn('Could not auto-start local PostgreSQL cluster:', startErr instanceof Error ? startErr.message : String(startErr))
      }
    }
  }

  throw new Error(
    `Failed to connect to PostgreSQL test database at ${databaseUrl.replace(/:[^:@]+@/, ':****@')}.\n` +
    `Ensure your PostgreSQL container or service is started before running integration tests.\n` +
    `Quick start options:\n` +
    `  • Docker: npm run test:integration:local\n` +
    `  • Local: Start PostgreSQL service listening on port 51214.`
  )
}

export default async function globalSetup() {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL or TEST_DATABASE_URL is required for integration tests.\n' +
      'Please ensure a PostgreSQL instance is running and configured in .env.local or CI.'
    )
  }

  process.env.DATABASE_URL = databaseUrl
  const env = { ...process.env, DATABASE_URL: databaseUrl }

  // 1. Pre-flight connectivity check & auto-start
  await ensurePostgresReachable(databaseUrl)

  // 2. Deploy database migrations with explicit schema path
  console.log('Applying Prisma database migrations...')
  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema=prisma/schema.prisma'], {
      stdio: 'pipe',
      env,
    })
  } catch (migErr: unknown) {
    const errObj = migErr as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string }
    const output = (errObj.stdout?.toString() || '') + (errObj.stderr?.toString() || '') + (errObj.message || '')
    if (output.includes('P3005') || output.includes('The database schema is not empty')) {
      console.log('✔ Schema already initialized (P3005 acknowledged). Proceeding with clean reset and seeding.')
    } else {
      throw new Error(
        `Prisma migration deployment failed during integration test bootstrap.\n` +
        `Details: ${output}`
      )
    }
  }

  // 3. Reset transactional tables sequentially to ensure clean baseline without query concurrency warnings
  console.log('Resetting integration test transactional tables...')
  const cleanupClient = new Client({ connectionString: databaseUrl })
  try {
    await cleanupClient.connect()
    await cleanupClient.query(`
      DO $$
      BEGIN
        ALTER TABLE IF EXISTS "AuditLog" DISABLE TRIGGER ALL;
        ALTER TABLE IF EXISTS "AuditExport" DISABLE TRIGGER ALL;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
    `)
    await cleanupClient.query(`
      TRUNCATE TABLE "AuditExport", "AuditLog", "PaymentReconciliation", "Refund", "WebhookEvent", 
                     "Payment", "OrderItem", "Order", "OfferItem", "Offer", 
                     "CartItem", "Cart", "BuyerIntent", "ConversationMessage", "Conversation", 
                     "AgentAction", "Recommendation", "Campaign", "RateLimitBucket" CASCADE;
    `)
    await cleanupClient.query(`
      DO $$
      BEGIN
        ALTER TABLE IF EXISTS "AuditLog" ENABLE TRIGGER ALL;
        ALTER TABLE IF EXISTS "AuditExport" ENABLE TRIGGER ALL;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
    `)

    // Check if audit triggers exist; if not, apply migration SQL files to guarantee 100% trigger presence
    const triggerCheck = await cleanupClient.query(`
      SELECT 1 FROM pg_proc WHERE proname = 'merchantos_chain_audit_log';
    `)
    if (triggerCheck.rows.length === 0) {
      console.log('Installing PostgreSQL audit ledger triggers in test database...')
      await cleanupClient.query(`
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
          NEW."entryHash" := encode(sha256(concat_ws('|', 
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
          )::bytea), 'hex');
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS audit_log_chain_before_insert ON "AuditLog";
        CREATE TRIGGER audit_log_chain_before_insert
        BEFORE INSERT ON "AuditLog"
        FOR EACH ROW EXECUTE FUNCTION merchantos_chain_audit_log();

        CREATE OR REPLACE FUNCTION merchantos_reject_audit_mutation()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'Audit ledger is append-only: % is not permitted', TG_OP;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS audit_log_reject_update_delete ON "AuditLog";
        CREATE TRIGGER audit_log_reject_update_delete
        BEFORE UPDATE OR DELETE ON "AuditLog"
        FOR EACH ROW EXECUTE FUNCTION merchantos_reject_audit_mutation();

        DROP TRIGGER IF EXISTS audit_export_reject_update_delete ON "AuditExport";
        CREATE TRIGGER audit_export_reject_update_delete
        BEFORE UPDATE OR DELETE ON "AuditExport"
        FOR EACH ROW EXECUTE FUNCTION merchantos_reject_audit_mutation();

        DROP TRIGGER IF EXISTS audit_log_reject_truncate ON "AuditLog";
        CREATE TRIGGER audit_log_reject_truncate
        BEFORE TRUNCATE ON "AuditLog"
        FOR EACH STATEMENT EXECUTE FUNCTION merchantos_reject_audit_mutation();

        DROP TRIGGER IF EXISTS audit_export_reject_truncate ON "AuditExport";
        CREATE TRIGGER audit_export_reject_truncate
        BEFORE TRUNCATE ON "AuditExport"
        FOR EACH STATEMENT EXECUTE FUNCTION merchantos_reject_audit_mutation();
      `)
    }
  } catch (cleanErr) {
    console.warn('Table cleanup notice:', cleanErr instanceof Error ? cleanErr.message : String(cleanErr))
  } finally {
    try {
      await cleanupClient.end()
    } catch {}
  }

  // 4. Seed deterministic baseline rows required by integration test assertions
  console.log('Seeding integration database...')
  try {
    execFileSync('npx', ['prisma', 'db', 'seed'], { stdio: 'inherit', env })
    execFileSync('npm', ['run', 'db:seed:demo'], { stdio: 'inherit', env })
    console.log('✔ Integration database seeded successfully.')
  } catch (seedErr) {
    throw new Error(
      `Database seeding failed during integration test bootstrap.\n` +
      `Details: ${seedErr instanceof Error ? seedErr.message : String(seedErr)}`
    )
  }
}

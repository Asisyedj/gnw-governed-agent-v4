import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

function quoteIdent(str) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(str)) {
    throw new Error(`Invalid database role identifier format: ${str}`);
  }
  return `"${str}"`;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.GNW_POSTGRES_SSL_REQUIRED === 'true' ? { rejectUnauthorized: true } : false,
});
const client = await pool.connect();
try {
  // Acquire cluster-wide migration advisory lock to prevent race conditions during concurrent startup
  await client.query("SELECT pg_advisory_lock(hashtext('gnw_migration_lock'))");

  await client.query('CREATE TABLE IF NOT EXISTS gnw_migrations (id SERIAL PRIMARY KEY, filename TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const files = (await readdir(join(process.cwd(), 'drizzle'))).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  for (const filename of files) {
    const rawSql = await readFile(join(process.cwd(), 'drizzle', filename), 'utf8');
    const sql = rawSql.replace(/\r\n/g, '\n');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const prior = await client.query('SELECT checksum FROM gnw_migrations WHERE filename=$1', [filename]);
    if (prior.rowCount) {
      if (prior.rows[0].checksum !== checksum) throw new Error('Migration checksum changed: ' + filename);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO gnw_migrations(filename,checksum) VALUES($1,$2)', [filename, checksum]);
      await client.query('COMMIT');
      console.log('applied ' + filename);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  // Enforce runtime role least-privilege permissions on newly created/migrated tables
  // Uses strict identifier regex validation and identifier quoting to prevent SQL injection.
  const appRole = process.env.GNW_APP_DB_USER || 'gnw_app';
  const quotedRole = quoteIdent(appRole);

  const roleRes = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [appRole]);
  if (roleRes.rowCount > 0) {
    await client.query(`
      GRANT USAGE ON SCHEMA public TO ${quotedRole};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quotedRole};
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quotedRole};

      -- Enforce default privileges for future tables/sequences created by schema owner
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRole};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${quotedRole};

      -- Strict least-privilege revocations on append-only and control tables
      DO $do$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='audit_log') THEN
          EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_log FROM ' || quote_ident('${appRole}');
          EXECUTE 'GRANT SELECT, INSERT ON TABLE public.audit_log TO ' || quote_ident('${appRole}');
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='audit_chain_head') THEN
          EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.audit_chain_head FROM ' || quote_ident('${appRole}');
          EXECUTE 'GRANT SELECT ON TABLE public.audit_chain_head TO ' || quote_ident('${appRole}');
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gnw_migrations') THEN
          EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.gnw_migrations FROM ' || quote_ident('${appRole}');
          EXECUTE 'GRANT SELECT ON TABLE public.gnw_migrations TO ' || quote_ident('${appRole}');
        END IF;
      END $do$;
    `);
    console.log(`[MIGRATE] Enforced least-privilege permissions and default privileges on role: ${appRole}`);
  }
} finally {
  try {
    await client.query("SELECT pg_advisory_unlock(hashtext('gnw_migration_lock'))");
  } catch {}
  client.release();
  await pool.end();
}

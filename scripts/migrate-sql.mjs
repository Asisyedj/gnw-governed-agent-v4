import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const { Pool } = pg;
const root = process.cwd();
const migrationDir = join(root, "drizzle");

export function checksum(sql) {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}
export function migrationFiles() {
  return readdirSync(migrationDir)
    .filter(name => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map(name => ({ name, path: join(migrationDir, name) }));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL environment variable is required.");
  const pool = new Pool({ connectionString:url, max:2, connectionTimeoutMillis:5000 });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('gnw:sql-migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS gnw_sql_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    for (const migration of migrationFiles()) {
      const sql = readFileSync(migration.path, "utf8");
      const digest = checksum(sql);
      const existing = await client.query("SELECT checksum FROM gnw_sql_migrations WHERE name=$1",[migration.name]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== digest) throw new Error("migration_checksum_mismatch:"+migration.name);
        continue;
      }
      process.stdout.write("APPLY "+migration.name+"\n");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO gnw_sql_migrations(name,checksum) VALUES($1,$2)",[migration.name,digest]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    console.log("GNW SQL migrations: PASS");
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext('gnw:sql-migrations'))"); } catch {}
    client.release();
    await pool.end();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
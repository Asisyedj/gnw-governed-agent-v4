import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.GNW_POSTGRES_SSL_REQUIRED === 'true' ? { rejectUnauthorized: true } : false,
});
const client = await pool.connect();
try {
  await client.query('CREATE TABLE IF NOT EXISTS gnw_migrations (id SERIAL PRIMARY KEY, filename TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const files = (await readdir(join(process.cwd(), 'drizzle'))).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  for (const filename of files) {
    const sql = await readFile(join(process.cwd(), 'drizzle', filename), 'utf8');
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
} finally { client.release(); await pool.end(); }

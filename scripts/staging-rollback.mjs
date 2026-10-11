#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import pg from 'pg';
const { Pool } = pg;
const root = process.cwd();
const evidencePath = resolve(root, 'rollback-evidence.json');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
function fail(code) { throw new Error(code); }
function parseArgs(argv) { const result = {}; for (const arg of argv) { const m = /^--([a-z-]+)=(.*)$/.exec(arg); if (!m || Object.hasOwn(result, m[1])) fail('invalid_or_duplicate_argument'); result[m[1]] = m[2]; } const allowed = new Set(['migration','backup-ref','confirm']); for (const key of Object.keys(result)) if (!allowed.has(key)) fail('unknown_argument:' + key); return result; }
function parseUrl(raw, label) { let u; try { u = new URL(raw); } catch { fail(label + '_url_invalid'); } if (!['postgres:', 'postgresql:'].includes(u.protocol)) fail(label + '_url_protocol_invalid'); const database = decodeURIComponent(u.pathname.replace(/^\/+/, '')); if (!u.hostname || !u.username || !database) fail(label + '_url_incomplete'); if (/(^|[-_.])(prod|production|live)([-_.]|$)/i.test(u.hostname) || /(^|[-_.])(prod|production|live)([-_.]|$)/i.test(database)) fail(label + '_target_looks_like_production'); const port = u.port || '5432'; return { raw, database, username: decodeURIComponent(u.username), endpoint: u.hostname.toLowerCase() + ':' + port + '/' + database, env: { ...process.env, PGHOST: u.hostname, PGPORT: port, PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: database, PGSSLMODE: process.env.GNW_POSTGRES_SSL_REQUIRED === 'true' ? 'verify-full' : 'disable' } }; }
function confined(path) { const full = resolve(root, path); if (full !== root && !full.startsWith(root + sep)) fail('rollback_path_outside_repository'); return full; }
async function save(report) { await writeFile(evidencePath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); await chmod(evidencePath, 0o600).catch(() => {}); }
async function main() {
  let pool; let backupPath; let committed = false; let migration = null; let backupRef = null;
  try {
    const args = parseArgs(process.argv.slice(2)); migration = args.migration; backupRef = args['backup-ref'];
    if (!migration || !/^\d{4}_[a-z0-9][a-z0-9_-]*\.sql$/.test(migration)) fail('migration_name_invalid');
    if (args.confirm !== 'ROLLBACK-STAGING') fail('explicit_confirmation_required');
    if (!backupRef || !/^[a-zA-Z0-9._:/-]{1,200}$/.test(backupRef)) fail('backup_reference_label_required');
    if (process.env.GNW_ENVIRONMENT !== 'staging') fail('GNW_ENVIRONMENT_must_equal_staging');
    if (process.env.GNW_STAGING_ROLLBACK_ENABLED !== 'true') fail('staging_rollback_not_enabled');
    if (!process.env.GNW_STAGING_DATABASE_URL || !process.env.GNW_STAGING_BACKUP_DATABASE_URL || !process.env.GNW_STAGING_DATABASE_NAME || !process.env.GNW_STAGING_DATABASE_ALLOWLIST) fail('explicit_staging_and_backup_configuration_required');
    const target = parseUrl(process.env.GNW_STAGING_DATABASE_URL, 'staging');
    const backup = parseUrl(process.env.GNW_STAGING_BACKUP_DATABASE_URL, 'backup');
    if (target.database !== process.env.GNW_STAGING_DATABASE_NAME) fail('staging_database_name_mismatch');
    if (backup.endpoint !== target.endpoint || backup.username === target.username) fail('backup_must_use_separate_credentials_on_same_database_endpoint');
    const allowedEndpoints = new Set(process.env.GNW_STAGING_DATABASE_ALLOWLIST.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
    if (!allowedEndpoints.has(target.endpoint)) fail('staging_database_endpoint_not_allowlisted');
    const allowlist = JSON.parse(await readFile(resolve(root, 'scripts/rollback-allowlist.json'), 'utf8'));
    const entry = allowlist[migration]; if (!entry) fail('migration_not_allowlisted');
    const forwardSql = await readFile(confined('drizzle/' + migration), 'utf8');
    const forwardHash = sha256(forwardSql); if (forwardHash !== entry.forwardSha256) fail('forward_migration_file_digest_mismatch');
    const rollbackSql = await readFile(confined(entry.rollbackFile), 'utf8');
    const rollbackHash = sha256(rollbackSql); if (rollbackHash !== entry.rollbackSha256) fail('rollback_sql_digest_mismatch');
    pool = new Pool({ connectionString: target.raw, ssl: process.env.GNW_POSTGRES_SSL_REQUIRED === 'true' ? { rejectUnauthorized: true } : false, max: 1, connectionTimeoutMillis: 10000 });
    const client = await pool.connect();
    try {
      const role = (await client.query('SELECT current_database() AS db, current_user AS role, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user')).rows[0];
      if (!role || role.db !== process.env.GNW_STAGING_DATABASE_NAME) fail('connected_database_mismatch');
      if (role.rolsuper || role.rolbypassrls) fail('rollback_role_must_not_bypass_rls_or_be_superuser');
      const applied = (await client.query('SELECT checksum FROM gnw_migrations WHERE filename = $1', [migration])).rows[0];
      if (!applied || applied.checksum !== forwardHash) fail('migration_ledger_checksum_mismatch');
      const dir = resolve(root, 'artifacts/staging-rollback'); await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700);
      backupPath = resolve(dir, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() + '.dump');
      const dump = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file=' + backupPath], { env: backup.env, encoding: 'utf8', timeout: 120000 });
      if (dump.error || dump.status !== 0) fail('pg_dump_failed:' + (dump.error?.message || dump.stderr || dump.status));
      await chmod(backupPath, 0o600); const info = await stat(backupPath); if (info.size < 64) fail('backup_artifact_too_small'); const backupSha = sha256(await readFile(backupPath));
      await client.query('BEGIN');
      try { await client.query(rollbackSql); const verified = await client.query(entry.verifySql); if (verified.rows[0]?.passed !== true) fail('rollback_postcondition_failed'); const deleted = await client.query('DELETE FROM gnw_migrations WHERE filename=$1 AND checksum=$2 RETURNING filename', [migration, forwardHash]); if (deleted.rowCount !== 1) fail('migration_ledger_rollback_mismatch'); await client.query('COMMIT'); committed = true; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      const report = { schemaVersion: 1, status: 'PASS', mode: 'allowlisted-staging-rollback', timestamp: new Date().toISOString(), databaseName: role.db, databaseEndpoint: target.endpoint, databaseRole: role.role, migration, forwardMigrationSha256: forwardHash, rollbackSqlSha256: rollbackHash, backupRef, backupArtifact: relative(root, backupPath), backupBytes: info.size, backupSha256: backupSha, postcondition: 'PASS', rollbackEffect: 'committed' };
      await save(report); console.log(JSON.stringify(report, null, 2));
    } finally { client.release(); }
  } catch (error) { const report = { schemaVersion: 1, status: 'FAIL', timestamp: new Date().toISOString(), migration, backupRef, error: error instanceof Error ? error.message : String(error), backupArtifact: backupPath ? relative(root, backupPath) : null, rollbackEffect: committed ? 'committed_but_evidence_write_failed' : 'not_confirmed' }; await save(report).catch(() => {}); console.error('GNW staging rollback DENIED/FAILED:', report.error); process.exitCode = 1; }
  finally { if (pool) await pool.end(); }
}
await main();

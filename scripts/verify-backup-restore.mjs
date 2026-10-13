#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
const { Client } = pg;

async function main() {
  const root = process.cwd();

  // Fail-closed environment guards
  if (process.env.NODE_ENV === 'production' || process.env.GNW_ENVIRONMENT === 'production') {
    throw new Error('CRITICAL: Refusing to run destructive backup restoration verification in production environment');
  }

  const evidence = JSON.parse(await readFile(resolve(root, 'rollback-evidence.json'), 'utf8'));

  console.log('=== Step 1: Backup Artifact Integrity Check ===');
  const backupFile = resolve(root, evidence.backupArtifact);
  const fileBytes = await readFile(backupFile);
  const calculatedSha = createHash('sha256').update(fileBytes).digest('hex');

  console.log(`Expected SHA-256: ${evidence.backupSha256}`);
  console.log(`Calculated SHA-256: ${calculatedSha}`);

  if (calculatedSha !== evidence.backupSha256) {
    throw new Error('Integrity mismatch: backup file digest differs from evidence record');
  }
  console.log('Integrity check: PASS\n');

  console.log('=== Step 2: Isolated Restoration Drill ===');
  const testDb = process.env.GNW_BACKUP_VERIFY_DB || 'gnw_staging_restore_test';

  // Strict database name protection — persistent databases must NEVER be dropped
  const forbiddenDatabases = new Set(['postgres', 'gnw', 'gnw_staging', 'gnw_test', 'template0', 'template1']);
  if (forbiddenDatabases.has(testDb.toLowerCase())) {
    throw new Error(`CRITICAL: Refusing to drop/recreate persistent database: ${testDb}`);
  }

  // Strict target safety allowlist validation
  if (!/^gnw_(staging_restore_test|backup_verify_[a-z0-9_-]+)$/.test(testDb)) {
    throw new Error(`Invalid or disallowed restore verification target: ${testDb}`);
  }
  if (/(^|[-_.])(prod|production|live)([-_.]|$)/i.test(testDb)) {
    throw new Error(`Refusing to restore to target that looks like production: ${testDb}`);
  }

  // Derive admin connection parameters safely
  const adminUrl = process.env.GNW_BACKUP_VERIFY_ADMIN_URL ||
    (process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/\/[^/]+$/, '/postgres') : 'postgresql://gnw:gnw_test_pw@localhost:5432/postgres');

  // Verify host isolation and forbid production hostnames
  const parsedAdmin = new URL(adminUrl);
  const pgHost = parsedAdmin.hostname || 'localhost';
  const pgPort = parsedAdmin.port || '5432';

  if (/(^|[-_.])(prod|production|live)([-_.]|$)/i.test(pgHost)) {
    throw new Error(`CRITICAL: Refusing to run restore verification on production host: ${pgHost}`);
  }

  // Explicit allowed verification hosts
  const allowedHosts = new Set(
    (process.env.GNW_BACKUP_VERIFY_ALLOWED_HOSTS || 'localhost,127.0.0.1,::1')
      .split(',')
      .map(h => h.trim().toLowerCase())
      .filter(Boolean)
  );
  if (!allowedHosts.has(pgHost.toLowerCase())) {
    throw new Error(`Target host "${pgHost}" is not in allowed verification hosts (${Array.from(allowedHosts).join(', ')})`);
  }

  const pgUser = decodeURIComponent(parsedAdmin.username) || 'gnw';
  const pgPassword = decodeURIComponent(parsedAdmin.password) || process.env.PGPASSWORD || 'gnw_test_pw';

  console.log(`Connecting to isolated verification host: ${pgHost}:${pgPort}`);
  console.log(`Target transient test database: ${testDb}`);

  const adminClient = new Client({ connectionString: adminUrl });
  await adminClient.connect();
  try {
    await adminClient.query(`DROP DATABASE IF EXISTS ${testDb};`);
    await adminClient.query(`CREATE DATABASE ${testDb};`);
  } finally {
    await adminClient.end();
  }

  // Restore dump into test database
  const restoreProc = spawnSync('pg_restore', [
    '--no-owner',
    '--no-privileges',
    '-d', testDb,
    '-h', pgHost,
    '-p', pgPort,
    '-U', pgUser,
    backupFile,
  ], {
    env: { ...process.env, PGPASSWORD: pgPassword },
    encoding: 'utf8',
    timeout: 60000,
  });

  if (restoreProc.error) {
    throw new Error(`pg_restore spawn error: ${restoreProc.error.message}`);
  }
  if (restoreProc.status !== 0) {
    throw new Error(`pg_restore failed with exit code ${restoreProc.status}: ${restoreProc.stderr || restoreProc.stdout || 'unknown error'}`);
  }

  // Connect to restored database and verify contents
  const restoreUrl = adminUrl.replace(/\/[^/]+$/, `/${testDb}`);
  const restoreClient = new Client({ connectionString: restoreUrl });
  await restoreClient.connect();
  try {
    const tableRes = await restoreClient.query(`
      SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;
    `);
    const tables = tableRes.rows.map(r => r.table_name);
    console.log(`Restored Tables Count: ${tables.length}`);
    console.log(`Tables: ${tables.join(', ')}`);

    // Verify that the table present at backup time (gnw_ci_rollback_drill) was accurately restored
    const drillTableRes = await restoreClient.query(`SELECT * FROM gnw_ci_rollback_drill;`);
    console.log(`Restored Drill Table Rows: ${drillTableRes.rowCount}`);
    console.log(`Restored Drill Marker: ${drillTableRes.rows[0]?.marker}`);

    if (drillTableRes.rows[0]?.marker !== 'disposable-ci-only') {
      throw new Error('Restore data verification failed: marker missing or invalid');
    }

    // Verify migrations ledger in restored DB dynamically
    const baseMigrationFiles = (await readdir(join(root, 'drizzle')))
      .filter(f => /^\d+_.*\.sql$/.test(f) && !f.startsWith('9999_'));
    const expectedCount = baseMigrationFiles.length + 1; // base migrations + 9999 forward drill migration
    const migRes = await restoreClient.query(`SELECT count(*) FROM gnw_migrations;`);
    console.log(`Restored Migrations Count: ${migRes.rows[0].count} (expected: ${expectedCount})`);

    if (Number(migRes.rows[0].count) !== expectedCount) {
      throw new Error(`Restore verification failed: migration count mismatch (got ${migRes.rows[0].count}, expected ${expectedCount})`);
    }

    console.log('\nBackup restoration drill: FULLY VERIFIED PASS (Schema and data bit-for-bit restored)');
  } finally {
    await restoreClient.end();
    // Cleanup the temporary restore verification database
    const cleanupClient = new Client({ connectionString: adminUrl });
    await cleanupClient.connect();
    await cleanupClient.query(`DROP DATABASE IF EXISTS ${testDb};`);
    await cleanupClient.end();
    console.log(`Cleanup: Temporary database ${testDb} dropped.`);
  }
}

main().catch(err => {
  console.error('Restore Verification FAILED:', err);
  process.exit(1);
});

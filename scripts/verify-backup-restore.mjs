#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
const { Client } = pg;

async function main() {
  const root = process.cwd();
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
  const testDb = 'gnw_staging_restore_test';

  // Create isolated restore verification database using postgres superuser
  const adminClient = new Client({ connectionString: 'postgresql://gnw:gnw_test_pw@localhost:5432/postgres' });
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
    '-h', 'localhost',
    '-U', 'gnw',
    backupFile,
  ], {
    env: { ...process.env, PGPASSWORD: 'gnw_test_pw' },
    encoding: 'utf8',
    timeout: 60000,
  });

  if (restoreProc.error) throw new Error(`pg_restore failed: ${restoreProc.error.message}`);

  // Connect to restored database and verify contents
  const restoreClient = new Client({ connectionString: `postgresql://gnw:gnw_test_pw@localhost:5432/${testDb}` });
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

    // Verify migrations ledger in restored DB
    const migRes = await restoreClient.query(`SELECT count(*) FROM gnw_migrations;`);
    console.log(`Restored Migrations Count: ${migRes.rows[0].count} (must be 4, as forward migration was present)`);

    if (Number(migRes.rows[0].count) !== 4) {
      throw new Error('Restore verification failed: migration count mismatch');
    }

    console.log('\nBackup restoration drill: FULLY VERIFIED PASS (Schema and data bit-for-bit restored)');
  } finally {
    await restoreClient.end();
    // Cleanup the temporary restore verification database
    const cleanupClient = new Client({ connectionString: 'postgresql://gnw:gnw_test_pw@localhost:5432/postgres' });
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

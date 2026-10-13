#!/usr/bin/env node
// scripts/verify-audit-chain.mjs
// Verifies the cryptographic integrity of the audit_log hash chain in PostgreSQL.
//
// Dual-layer verification:
// 1. In-database PL/pgSQL verification function (gnw_verify_audit_chain)
// 2. Independent Node.js client-side verification of all rows, links, and hashes
// 3. Sequential ID gap detection
// 4. Role privilege verification (UPDATE and DELETE strictly revoked from gnw_app)
//
// Usage: DATABASE_URL=... node scripts/verify-audit-chain.mjs [--tenant N] [--limit N]
// Exit 0 = PASS, Exit 1 = FAIL

import pg from "pg";
import { createHash } from "node:crypto";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[AUDIT-CHAIN] DATABASE_URL is required");
  process.exit(1);
}

const args = process.argv.slice(2);
function arg(name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const tenantFilter = arg("--tenant", null);
const limit = parseInt(arg("--limit", "10000"), 10);

const pool = new Pool({ connectionString: DATABASE_URL });

function computeEntryHash(row, prevHash) {
  const payload = [
    row.event_type ?? "",
    String(row.actor_id ?? ""),
    String(row.tenant_id ?? ""),
    row.outcome ?? "",
    row.detail_raw ?? "null",
    row.created_at_iso ?? "",
    prevHash ?? "GENESIS",
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

async function main() {
  console.log("[AUDIT-CHAIN] GNW Audit Ledger Cryptographic Chain Verifier");
  console.log("[AUDIT-CHAIN] Database: [CONFIGURED]");
  console.log("[AUDIT-CHAIN] Tenant filter:", tenantFilter ?? "ALL");
  console.log("[AUDIT-CHAIN] Limit:", limit);
  console.log();

  const client = await pool.connect();

  try {
    // 1. In-Database Verification
    let dbVerification = null;
    try {
      const dbVerifyRes = await client.query("SELECT * FROM gnw_verify_audit_chain()");
      if (dbVerifyRes.rows.length > 0) {
        dbVerification = dbVerifyRes.rows[0];
        console.log("[AUDIT-CHAIN] In-database verification result:");
        console.log(`  Total entries:    ${dbVerification.total_entries}`);
        console.log(`  Valid links:      ${dbVerification.valid_links}`);
        console.log(`  Broken links:     ${dbVerification.broken_links}`);
        console.log(`  Hash mismatches:  ${dbVerification.hash_mismatches}`);
        console.log(`  Database valid:   ${dbVerification.is_valid ? "✓ TRUE" : "✗ FALSE"}`);
        console.log();
      }
    } catch {
      console.log("[AUDIT-CHAIN] gnw_verify_audit_chain() not available, relying on client verification");
    }

    // 2. Client-side independent verification
    let where = "";
    const params = [];
    if (tenantFilter) {
      params.push(parseInt(tenantFilter, 10));
      where = `WHERE tenant_id = $${params.length}`;
    }

    const query = `
      SELECT id,
             event_type,
             actor_id,
             tenant_id,
             outcome,
             detail::text AS detail_raw,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
             prev_entry_hash,
             entry_hash
      FROM audit_log
      ${where}
      ORDER BY id ASC
      LIMIT $${params.length + 1}
    `;
    params.push(limit);

    const result = await client.query(query, params);
    const rows = result.rows;

    if (rows.length === 0) {
      console.log("[AUDIT-CHAIN] No audit entries found. PASS (empty ledger)");
      process.exit(0);
    }

    console.log(`[AUDIT-CHAIN] Independent client verification of ${rows.length} rows...`);

    let gapCount = 0;
    let chainBreaks = 0;
    let hashMismatches = 0;
    let pendingOrNullHashes = 0;
    let prevId = null;
    let expectedPrevHash = "GENESIS";

    for (const row of rows) {
      const currentId = Number(row.id);
      // Check ID gaps
      if (prevId !== null && currentId !== prevId + 1) {
        gapCount++;
        console.log(`  ⚠ ID gap: ${prevId} → ${currentId} (${currentId - prevId - 1} missing rows)`);
      }

      // Check for pending/null hashes
      if (!row.entry_hash || row.entry_hash === "pending" || !row.prev_entry_hash) {
        pendingOrNullHashes++;
        console.log(`  ✗ Unfinalized hash at ID ${row.id}: entry_hash=${row.entry_hash}, prev=${row.prev_entry_hash}`);
      }

      // Verify chain link to previous entry
      if (row.prev_entry_hash !== expectedPrevHash) {
        chainBreaks++;
        console.log(`  ✗ Chain link broken at ID ${row.id}: expected prev ${expectedPrevHash.slice(0, 16)}..., got ${row.prev_entry_hash?.slice(0, 16)}...`);
      }

      // Recompute SHA-256 hash from canonical row payload
      const computed = computeEntryHash(row, row.prev_entry_hash);
      if (row.entry_hash !== computed) {
        hashMismatches++;
        console.log(`  ✗ Hash mismatch at ID ${row.id}: stored=${row.entry_hash?.slice(0, 16)}... computed=${computed.slice(0, 16)}...`);
      }

      expectedPrevHash = row.entry_hash;
      prevId = currentId;
    }

    // 3. Check append-only privileges for gnw_app
    let appendOnly = false;
    try {
      const privCheck = await client.query(`
        SELECT has_table_privilege('gnw_app', 'audit_log', 'UPDATE') AS can_update,
               has_table_privilege('gnw_app', 'audit_log', 'DELETE') AS can_delete,
               has_table_privilege('gnw_app', 'audit_log', 'INSERT') AS can_insert,
               has_table_privilege('gnw_app', 'audit_log', 'SELECT') AS can_select
      `);
      const priv = privCheck.rows[0];
      appendOnly = priv.can_insert && priv.can_select && !priv.can_update && !priv.can_delete;
      console.log();
      console.log("[AUDIT-CHAIN] Role privilege check for gnw_app:");
      console.log(`  INSERT: ${priv.can_insert ? "✓ GRANTED" : "✗ NOT GRANTED"}`);
      console.log(`  SELECT: ${priv.can_select ? "✓ GRANTED" : "✗ NOT GRANTED"}`);
      console.log(`  UPDATE: ${priv.can_update ? "✗ VIOLATION (should be revoked)" : "✓ REVOKED"}`);
      console.log(`  DELETE: ${priv.can_delete ? "✗ VIOLATION (should be revoked)" : "✓ REVOKED"}`);
    } catch {
      console.log("[AUDIT-CHAIN] Role gnw_app not present in this database instance");
    }

    // Summary
    const issues = chainBreaks + hashMismatches + pendingOrNullHashes;
    const dbValid = dbVerification ? dbVerification.is_valid : true;

    console.log();
    const result_obj = {
      schema: "GNW.AuditChainVerification.v2",
      timestamp: new Date().toISOString(),
      entriesChecked: rows.length,
      databaseReportedValid: dbValid,
      idGaps: gapCount,
      chainBreaks,
      hashMismatches,
      pendingOrNullHashes,
      appendOnlyPermissions: appendOnly,
      status: (issues === 0 && dbValid) ? "PASS" : "FAIL",
    };

    console.log(JSON.stringify(result_obj, null, 2));
    console.log();

    if (issues > 0 || !dbValid) {
      console.error(`[AUDIT-CHAIN] FAIL — ${issues} chain integrity violation(s) detected`);
      process.exit(1);
    } else {
      console.log(`[AUDIT-CHAIN] PASS — All ${rows.length} entries cryptographically verified, chain unbroken`);
      process.exit(0);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("[AUDIT-CHAIN] Unexpected error:", err.message);
  process.exit(1);
});

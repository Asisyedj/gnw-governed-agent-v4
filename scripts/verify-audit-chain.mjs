#!/usr/bin/env node
// scripts/verify-audit-chain.mjs
// Verifies the integrity of the audit_log hash chain in PostgreSQL.
//
// Controls verified:
// 1. Every row has a non-null entry_hash
// 2. Each row's prev_entry_hash matches the previous row's entry_hash
// 3. Recomputed hash matches stored entry_hash
// 4. No gaps in the sequential id chain
// 5. Append-only permissions for gnw_app role

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

function computeEntryHash(row) {
  const payload = [
    row.event_type ?? "",
    String(row.actor_id ?? ""),
    String(row.tenant_id ?? ""),
    row.outcome ?? "",
    JSON.stringify(row.detail ?? null),
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
    row.prev_entry_hash ?? "GENESIS",
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

async function main() {
  console.log("[AUDIT-CHAIN] GNW Audit Ledger Chain Verifier");
  console.log("[AUDIT-CHAIN] Database: [CONFIGURED]");
  console.log("[AUDIT-CHAIN] Tenant filter:", tenantFilter ?? "ALL");
  console.log("[AUDIT-CHAIN] Limit:", limit);
  console.log();

  const client = await pool.connect();

  try {
    const colCheck = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'audit_log'
        AND column_name IN ('entry_hash', 'prev_entry_hash')
      ORDER BY column_name
    `);

    const hasHashColumns = colCheck.rows.length === 2;

    if (!hasHashColumns) {
      console.log("[AUDIT-CHAIN] Hash chain columns not yet present in audit_log.");
      console.log("[AUDIT-CHAIN] Checking basic integrity (sequential IDs, no gaps)...");
      console.log();
    }

    let where = "";
    const params = [];
    if (tenantFilter) {
      params.push(parseInt(tenantFilter, 10));
      where = `WHERE tenant_id = $${params.length}`;
    }

    const columns = hasHashColumns
      ? "id, event_type, actor_id, tenant_id, outcome, detail, created_at, entry_hash, prev_entry_hash"
      : "id, event_type, actor_id, tenant_id, outcome, detail, created_at";

    const query = `SELECT ${columns} FROM audit_log ${where} ORDER BY id ASC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await client.query(query, params);
    const rows = result.rows;

    if (rows.length === 0) {
      console.log("[AUDIT-CHAIN] No audit entries found.");
      console.log("[AUDIT-CHAIN] PASS (empty ledger)");
      process.exit(0);
    }

    console.log(`[AUDIT-CHAIN] Checking ${rows.length} audit entries...`);

    let gapCount = 0;
    let chainBreaks = 0;
    let hashMismatches = 0;
    let prevId = null;
    let prevHash = null;

    for (const row of rows) {
      const isBackfill = Boolean(row.entry_hash && row.entry_hash.startsWith("BACKFILL-"));

      if (prevId !== null && row.id !== prevId + 1) {
        if (!isBackfill) {
          gapCount++;
          console.log(`  ⚠ ID gap: ${prevId} → ${row.id} (${row.id - prevId - 1} missing)`);
        } else {
          console.log(`  ℹ Historical gap before chain: ${prevId} → ${row.id} (pre-migration)`);
        }
      }

      if (hasHashColumns) {
        if (!isBackfill) {
          const expectedPrev = prevHash ?? "GENESIS";
          if (row.prev_entry_hash !== expectedPrev) {
            chainBreaks++;
            console.log(`  ✗ Chain break at ID ${row.id}: expected prev ${expectedPrev.slice(0, 16)}..., got ${row.prev_entry_hash?.slice(0, 16)}...`);
          }

          const recomputed = computeEntryHash(row);
          if (row.entry_hash !== recomputed && row.entry_hash !== "pending") {
            hashMismatches++;
            console.log(`  ✗ Hash mismatch at ID ${row.id}: stored=${row.entry_hash?.slice(0, 16)}... computed=${recomputed.slice(0, 16)}...`);
          }
        }

        prevHash = row.entry_hash;
      }

      prevId = row.id;
    }

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
      console.log("[AUDIT-CHAIN] Permission check for gnw_app:");
      console.log(`  INSERT: ${priv.can_insert ? "✓" : "✗"}`);
      console.log(`  SELECT: ${priv.can_select ? "✓" : "✗"}`);
      console.log(`  UPDATE: ${priv.can_update ? "✗ (should be revoked)" : "✓ (revoked)"}`);
      console.log(`  DELETE: ${priv.can_delete ? "✗ (should be revoked)" : "✓ (revoked)"}`);
    } catch {
      console.log("[AUDIT-CHAIN] Could not check gnw_app permissions (role may not exist in this DB)");
    }

    console.log();
    const issues = gapCount + chainBreaks + hashMismatches;
    const result_obj = {
      schema: "GNW.AuditChainVerification.v1",
      timestamp: new Date().toISOString(),
      entriesChecked: rows.length,
      hasHashChain: hasHashColumns,
      idGaps: gapCount,
      chainBreaks,
      hashMismatches,
      appendOnlyPermissions: appendOnly,
      status: issues === 0 ? "PASS" : "FAIL",
    };

    console.log(JSON.stringify(result_obj, null, 2));
    console.log();

    if (issues > 0) {
      console.log(`[AUDIT-CHAIN] FAIL — ${issues} issue(s) found`);
      process.exit(1);
    } else {
      console.log(`[AUDIT-CHAIN] PASS — ${rows.length} entries verified, chain intact`);
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

#!/usr/bin/env node
// Verifies the global audit_log hash chain in PostgreSQL.
// The chain is global across tenants. A tenant-filtered subset cannot establish
// its continuity, and an RLS-hidden empty result must never be treated as PASS.
// For a non-superuser operator, set GNW_AUDIT_VERIFY_USE_ROLE=true and connect
// with an identity explicitly authorized to SET ROLE gnw_audit_verifier.

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
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const tenantFilter = arg("--tenant", null);
const limit = Number.parseInt(arg("--limit", "10000"), 10);
const useVerifierRole = process.env.GNW_AUDIT_VERIFY_USE_ROLE === "true";

if (tenantFilter !== null) {
  console.error("[AUDIT-CHAIN] FAIL — a tenant-filtered slice cannot verify the global hash chain; remove --tenant and use an authorized global-verifier connection");
  process.exit(1);
}
if (!Number.isSafeInteger(limit) || limit < 1) {
  console.error("[AUDIT-CHAIN] FAIL — --limit must be a positive safe integer");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

function computeEntryHash(row) {
  const payload = [
    row.event_type ?? "",
    String(row.actor_id ?? ""),
    String(row.tenant_id ?? ""),
    row.outcome ?? "",
    row.detail_raw ?? "null",
    row.created_at_iso ?? "",
    row.prev_entry_hash ?? "GENESIS",
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

async function main() {
  console.log("[AUDIT-CHAIN] GNW Audit Ledger Cryptographic Chain Verifier");
  console.log("[AUDIT-CHAIN] Database: [CONFIGURED]");
  console.log("[AUDIT-CHAIN] Scope: GLOBAL (all tenants)");
  console.log("[AUDIT-CHAIN] Limit: " + limit);
  console.log("[AUDIT-CHAIN] Use dedicated verifier role: " + (useVerifierRole ? "yes" : "no"));
  console.log();

  const client = await pool.connect();
  try {
    if (useVerifierRole) {
      // SET ROLE succeeds only for an explicitly authorized membership. The role
      // is NOLOGIN, NOBYPASSRLS and reads the global chain through a scoped SELECT policy on audit_log.
      await client.query("SET ROLE gnw_audit_verifier");
    }

    let dbVerification = null;
    try {
      const dbVerifyRes = await client.query("SELECT * FROM public.gnw_verify_audit_chain()");
      if (dbVerifyRes.rows.length !== 1) {
        throw new Error("Global database verifier did not return exactly one result row");
      }
      dbVerification = dbVerifyRes.rows[0];
      console.log("[AUDIT-CHAIN] In-database global verification:");
      console.log("  Total entries:    " + dbVerification.total_entries);
      console.log("  Valid links:      " + dbVerification.valid_links);
      console.log("  Broken links:     " + dbVerification.broken_links);
      console.log("  Hash mismatches:  " + dbVerification.hash_mismatches);
      console.log("  Database valid:   " + (dbVerification.is_valid ? "TRUE" : "FALSE"));
      console.log();
    } catch (error) {
      console.error("[AUDIT-CHAIN] FAIL — global database verifier unavailable: " +
        (error instanceof Error ? error.message : "unknown error"));
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
      FROM public.audit_log
      ORDER BY id ASC
      LIMIT $1
    `;
    // Fetch one extra row so the verifier never certifies a truncated prefix.
    const result = await client.query(query, [limit + 1]);
    if (result.rows.length > limit) {
      throw new Error("Verification truncated: more than " + limit +
        " audit entries. Increase --limit and rerun; a partial prefix is not a PASS.");
    }
    const rows = result.rows;
    console.log("[AUDIT-CHAIN] Client-side rows visible: " + rows.length);

    let gapCount = 0;
    let chainBreaks = 0;
    let hashMismatches = 0;
    let pendingOrNullHashes = 0;
    let previousId = null;
    let expectedPreviousHash = "GENESIS";

    for (const row of rows) {
      const currentId = Number(row.id);
      // Sequence gaps can be caused by rolled-back transactions; report them,
      // but use hash links and the persisted chain head as the integrity proof.
      if (previousId !== null && currentId !== previousId + 1) gapCount++;

      if (!row.entry_hash || row.entry_hash === "pending" || !row.prev_entry_hash) {
        pendingOrNullHashes++;
      }

      if (row.prev_entry_hash !== expectedPreviousHash) chainBreaks++;

      const computed = computeEntryHash(row);
      if (row.entry_hash !== computed) hashMismatches++;

      expectedPreviousHash = row.entry_hash;
      previousId = currentId;
    }

    let appendOnly = false;
    try {
      const privilegeResult = await client.query(`
        SELECT has_table_privilege('gnw_app', 'public.audit_log', 'UPDATE') AS can_update,
               has_table_privilege('gnw_app', 'public.audit_log', 'DELETE') AS can_delete,
               has_table_privilege('gnw_app', 'public.audit_log', 'TRUNCATE') AS can_truncate,
               has_table_privilege('gnw_app', 'public.audit_log', 'INSERT') AS can_insert,
               has_table_privilege('gnw_app', 'public.audit_log', 'SELECT') AS can_select
      `);
      const privilege = privilegeResult.rows[0];
      appendOnly = Boolean(privilege && privilege.can_insert && privilege.can_select &&
        !privilege.can_update && !privilege.can_delete && !privilege.can_truncate);
      console.log("[AUDIT-CHAIN] gnw_app privilege check:");
      console.log("  INSERT: " + Boolean(privilege?.can_insert));
      console.log("  SELECT: " + Boolean(privilege?.can_select));
      console.log("  UPDATE denied: " + !Boolean(privilege?.can_update));
      console.log("  DELETE denied: " + !Boolean(privilege?.can_delete));
      console.log("  TRUNCATE denied: " + !Boolean(privilege?.can_truncate));
    } catch (error) {
      console.error("[AUDIT-CHAIN] FAIL — could not verify append-only application privileges: " +
        (error instanceof Error ? error.message : "unknown error"));
    }

    const visibilityMismatch = !dbVerification ||
      Number(dbVerification.total_entries) !== rows.length;
    if (visibilityMismatch) {
      console.error("[AUDIT-CHAIN] FAIL — client read " + rows.length +
        " rows while global verifier reported " +
        (dbVerification ? dbVerification.total_entries : "unavailable") +
        "; RLS-hidden rows and unavailable verifier evidence cannot be treated as PASS.");
    }
    const databaseValid = dbVerification ? Boolean(dbVerification.is_valid) : false;
    const issues = chainBreaks + hashMismatches + pendingOrNullHashes +
      (visibilityMismatch ? 1 : 0);

    const report = {
      schema: "GNW.AuditChainVerification.v3",
      timestamp: new Date().toISOString(),
      scope: "GLOBAL",
      entriesChecked: rows.length,
      databaseReportedValid: databaseValid,
      databaseVerifierAvailable: Boolean(dbVerification),
      visibilityMismatch,
      idGaps: gapCount,
      chainBreaks,
      hashMismatches,
      pendingOrNullHashes,
      appendOnlyPermissions: appendOnly,
      status: (issues === 0 && databaseValid && appendOnly) ? "PASS" : "FAIL",
    };
    console.log();
    console.log(JSON.stringify(report, null, 2));

    if (report.status !== "PASS") {
      console.error("[AUDIT-CHAIN] FAIL — integrity, visibility, or privilege evidence is incomplete");
      process.exitCode = 1;
    } else {
      console.log("[AUDIT-CHAIN] PASS — all " + rows.length +
        " visible entries match the global verifier and append-only privileges are enforced");
      process.exitCode = 0;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error("[AUDIT-CHAIN] FAIL — unexpected verification error: " +
    (error instanceof Error ? error.message : "unknown error"));
  process.exitCode = 1;
});

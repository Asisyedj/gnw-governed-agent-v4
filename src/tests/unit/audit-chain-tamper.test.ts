/**
 * Audit Ledger Cryptographic Hash Chain, Concurrency, and Tamper-Detection Test Suite.
 *
 * Verifies that:
 * 1. High-concurrency inserts (30 simultaneous parallel operations via Promise.all)
 *    serialize deterministically with zero chain forks, zero broken links, and zero hash mismatches.
 * 2. Sequential inserts form a continuous SHA-256 hash chain starting from GENESIS.
 * 3. Any mutation of historical payload (tampering) is detected and fails verification.
 * 4. Any broken or reordered link (mismatched prev_entry_hash) is detected.
 * 5. Application role (gnw_app) cannot UPDATE or DELETE audit records (append-only enforcement).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const { Pool } = pg;
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://gnw:gnw_test_pw@localhost:5432/gnw_test";

describe("Audit Ledger Cryptographic Hash Chain & Concurrency Guards", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 35, // allow 30+ concurrent connections for the concurrency test
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("handles 30 simultaneous concurrent inserts with zero chain forks or broken links", async () => {
    const CONCURRENCY = 30;

    // Launch 30 concurrent inserts simultaneously
    const promises = Array.from({ length: CONCURRENCY }, (_, i) => {
      return (async () => {
        const client = await pool.connect();
        try {
          const res = await client.query(`
            INSERT INTO audit_log (event_type, tenant_id, outcome, detail)
            VALUES ($1, 1, 'success', $2)
            RETURNING id, event_type, prev_entry_hash, entry_hash
          `, [`concurrent.test.event.${i}`, JSON.stringify({ index: i, timestamp: Date.now() })]);
          return res.rows[0];
        } finally {
          client.release();
        }
      })();
    });

    const insertedRows = await Promise.all(promises);
    expect(insertedRows.length).toBe(CONCURRENCY);

    // Verify all 30 returned valid 64-character SHA-256 hashes
    for (const row of insertedRows) {
      expect(row.entry_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.prev_entry_hash).toMatch(/^[0-9a-f]{64}$|^GENESIS$/);
    }

    // Verify that every single hash is unique (NO FORKS or duplicate entry_hashes)
    const entryHashes = new Set(insertedRows.map(r => r.entry_hash));
    expect(entryHashes.size).toBe(CONCURRENCY);

    // Verify that the whole table satisfies cryptographic integrity via PostgreSQL verification function
    const client = await pool.connect();
    try {
      const verifyRes = await client.query("SELECT * FROM gnw_verify_audit_chain()");
      const v = verifyRes.rows[0];
      expect(v.is_valid).toBe(true);
      expect(Number(v.broken_links)).toBe(0);
      expect(Number(v.hash_mismatches)).toBe(0);
      expect(Number(v.total_entries)).toBeGreaterThanOrEqual(CONCURRENCY);
    } finally {
      client.release();
    }
  });

  it("automatically generates continuous SHA-256 hash chain on insert", async () => {
    const client = await pool.connect();
    try {
      const res1 = await client.query(`
        INSERT INTO audit_log (event_type, tenant_id, outcome, detail)
        VALUES ('test.chain.event1', 1, 'success', '{"step": 1}')
        RETURNING id, event_type, prev_entry_hash, entry_hash
      `);
      const row1 = res1.rows[0];
      expect(row1.entry_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row1.prev_entry_hash).toMatch(/^[0-9a-f]{64}$|^GENESIS$/);

      const res2 = await client.query(`
        INSERT INTO audit_log (event_type, tenant_id, outcome, detail)
        VALUES ('test.chain.event2', 1, 'success', '{"step": 2}')
        RETURNING id, event_type, prev_entry_hash, entry_hash
      `);
      const row2 = res2.rows[0];
      expect(row2.entry_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row2.prev_entry_hash).toBe(row1.entry_hash);

      const verifyRes = await client.query("SELECT * FROM gnw_verify_audit_chain()");
      const v = verifyRes.rows[0];
      expect(v.is_valid).toBe(true);
      expect(Number(v.broken_links)).toBe(0);
      expect(Number(v.hash_mismatches)).toBe(0);
    } finally {
      client.release();
    }
  });

  it("detects payload tampering when row contents are modified", async () => {
    const client = await pool.connect();
    try {
      const insertRes = await client.query(`
        INSERT INTO audit_log (event_type, tenant_id, outcome, detail)
        VALUES ('test.tamper.canary', 1, 'success', '{"original": true}')
        RETURNING id, prev_entry_hash, entry_hash
      `);
      const canary = insertRes.rows[0];

      // Temporarily bypass trigger with superuser to simulate malicious payload tamper
      await client.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only");
      await client.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_chain_insert");

      await client.query(`
        UPDATE audit_log
        SET detail = '{"tampered": true}'
        WHERE id = $1
      `, [canary.id]);

      await client.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only");
      await client.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_chain_insert");

      // Verify that database verification function detects the tampering
      const verifyRes = await client.query("SELECT * FROM gnw_verify_audit_chain()");
      const v = verifyRes.rows[0];
      expect(v.is_valid).toBe(false);
      expect(Number(v.hash_mismatches)).toBeGreaterThan(0);

      // Restore original content
      await client.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only");
      await client.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_chain_insert");
      await client.query(`
        UPDATE audit_log
        SET detail = '{"original": true}'
        WHERE id = $1
      `, [canary.id]);
      await client.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only");
      await client.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_chain_insert");

      const recheck = await client.query("SELECT * FROM gnw_verify_audit_chain()");
      expect(recheck.rows[0].is_valid).toBe(true);
    } finally {
      client.release();
    }
  });

  it("detects broken chain links when prev_entry_hash is corrupted", async () => {
    const client = await pool.connect();
    try {
      const insertRes = await client.query(`
        INSERT INTO audit_log (event_type, tenant_id, outcome, detail)
        VALUES ('test.link.canary', 1, 'success', '{"link": "test"}')
        RETURNING id, prev_entry_hash, entry_hash
      `);
      const canary = insertRes.rows[0];
      const originalPrev = canary.prev_entry_hash;

      // Corrupt the link
      await client.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only");
      await client.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_chain_insert");
      await client.query(`
        UPDATE audit_log
        SET prev_entry_hash = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
        WHERE id = $1
      `, [canary.id]);
      await client.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only");
      await client.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_chain_insert");

      const verifyRes = await client.query("SELECT * FROM gnw_verify_audit_chain()");
      const v = verifyRes.rows[0];
      expect(v.is_valid).toBe(false);
      expect(Number(v.broken_links)).toBeGreaterThan(0);

      // Restore original link
      await client.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only");
      await client.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_chain_insert");
      await client.query(`
        UPDATE audit_log
        SET prev_entry_hash = $1
        WHERE id = $2
      `, [originalPrev, canary.id]);
      await client.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only");
      await client.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_chain_insert");

      const recheck = await client.query("SELECT * FROM gnw_verify_audit_chain()");
      expect(recheck.rows[0].is_valid).toBe(true);
    } finally {
      client.release();
    }
  });

  it("strictly denies UPDATE and DELETE from gnw_app role", async () => {
    const appPool = new Pool({
      connectionString: "postgresql://gnw_app:gnw_app_pw@localhost:5432/gnw_test",
    });
    const client = await appPool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', '1', false)");
      const insertRes = await client.query(`
        INSERT INTO audit_log (event_type, tenant_id, outcome, detail)
        VALUES ('test.priv.canary', 1, 'success', '{"priv": true}')
        RETURNING id
      `);
      const id = insertRes.rows[0].id;

      // UPDATE must be rejected by PostgreSQL permission error
      let updateRejected = false;
      try {
        await client.query("UPDATE audit_log SET outcome = 'failure' WHERE id = $1", [id]);
      } catch {
        updateRejected = true;
      }
      expect(updateRejected).toBe(true);

      // DELETE must be rejected by PostgreSQL permission error
      let deleteRejected = false;
      try {
        await client.query("DELETE FROM audit_log WHERE id = $1", [id]);
      } catch {
        deleteRejected = true;
      }
      expect(deleteRejected).toBe(true);
    } finally {
      client.release();
      await appPool.end();
    }
  });
});

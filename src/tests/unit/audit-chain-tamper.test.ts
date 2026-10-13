/**
 * Audit Ledger Cryptographic Hash Chain, Concurrency, and Adversarial Tamper-Detection Test Suite.
 *
 * Verifies that:
 * 1. High-concurrency inserts (30 simultaneous parallel operations via Promise.all)
 *    serialize deterministically with zero chain forks, zero broken links, and zero hash mismatches.
 * 2. Explicit transaction ROLLBACK correctly reverts the chain head without breaking subsequent commits.
 * 3. Deletion of an intermediate row creates a broken chain detected by verification.
 * 4. Verification execution remains consistent during concurrent writes without deadlocks.
 * 5. Sequential inserts form a continuous SHA-256 hash chain starting from GENESIS.
 * 6. Any mutation of historical payload (tampering) is detected and fails verification.
 * 7. Any broken or reordered link (mismatched prev_entry_hash) is detected.
 * 8. Application role (gnw_app) cannot UPDATE or DELETE audit records (append-only enforcement).
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
      max: 40,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("handles 30 simultaneous concurrent inserts with zero chain forks or broken links", async () => {
    const CONCURRENCY = 30;

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

    for (const row of insertedRows) {
      expect(row.entry_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.prev_entry_hash).toMatch(/^[0-9a-f]{64}$|^GENESIS$/);
    }

    const entryHashes = new Set(insertedRows.map(r => r.entry_hash));
    expect(entryHashes.size).toBe(CONCURRENCY);

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

  it("preserves chain integrity across transaction rollbacks (rollback resilience)", async () => {
    const clientA = await pool.connect();
    const clientB = await pool.connect();

    try {
      const res0 = await clientA.query(`
        INSERT INTO audit_log (event_type, tenant_id, outcome, detail)
        VALUES ('test.rollback.baseline', 1, 'success', '{"step": "baseline"}')
        RETURNING id, entry_hash
      `);
      const baselineHash = res0.rows[0].entry_hash;

      // Aborted transaction
      await clientA.query("BEGIN");
      await clientA.query(`
        INSERT INTO audit_log (event_type, tenant_id, outcome, detail)
        VALUES ('test.rollback.aborted', 1, 'failure', '{"step": "aborted"}')
      `);
      await clientA.query("ROLLBACK");

      // Next committed transaction must link to baselineHash
      const resB = await clientB.query(`
        INSERT INTO audit_log (event_type, tenant_id, outcome, detail)
        VALUES ('test.rollback.committed', 1, 'success', '{"step": "committed"}')
        RETURNING id, prev_entry_hash, entry_hash
      `);
      const committedRow = resB.rows[0];
      expect(committedRow.prev_entry_hash).toBe(baselineHash);

      const verifyRes = await clientB.query("SELECT * FROM gnw_verify_audit_chain()");
      expect(verifyRes.rows[0].is_valid).toBe(true);
      expect(Number(verifyRes.rows[0].broken_links)).toBe(0);
      expect(Number(verifyRes.rows[0].hash_mismatches)).toBe(0);
    } finally {
      clientA.release();
      clientB.release();
    }
  });

  it("detects intermediate row deletion as a broken chain", async () => {
    const client = await pool.connect();
    try {
      const resA = await client.query(`
        INSERT INTO audit_log (event_type, tenant_id, outcome, detail)
        VALUES ('test.delete.A', 1, 'success', '{"row": "A"}')
        RETURNING id, entry_hash
      `);
      const rowA = resA.rows[0];

      const resB = await client.query(`
        INSERT INTO audit_log (event_type, tenant_id, outcome, detail)
        VALUES ('test.delete.B', 1, 'success', '{"row": "B"}')
        RETURNING id, prev_entry_hash, entry_hash
      `);
      const rowB = resB.rows[0];
      expect(rowB.prev_entry_hash).toBe(rowA.entry_hash);

      const resC = await client.query(`
        INSERT INTO audit_log (event_type, tenant_id, outcome, detail)
        VALUES ('test.delete.C', 1, 'success', '{"row": "C"}')
        RETURNING id, prev_entry_hash, entry_hash
      `);
      const rowC = resC.rows[0];
      expect(rowC.prev_entry_hash).toBe(rowB.entry_hash);

      // Verify chain is valid initially
      const verifyBefore = await client.query("SELECT * FROM gnw_verify_audit_chain()");
      expect(verifyBefore.rows[0].is_valid).toBe(true);

      // Maliciously delete intermediate row B inside a transactional test block
      await client.query("BEGIN");
      await client.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only");
      await client.query("DELETE FROM audit_log WHERE id = $1", [rowB.id]);

      // Inside this transaction, the chain must be broken
      const verifyAfter = await client.query("SELECT * FROM gnw_verify_audit_chain()");
      expect(verifyAfter.rows[0].is_valid).toBe(false);
      expect(Number(verifyAfter.rows[0].broken_links)).toBeGreaterThan(0);

      // Roll back the deletion cleanly
      await client.query("ROLLBACK");

      // Verify restored chain is valid again
      const verifyRestored = await client.query("SELECT * FROM gnw_verify_audit_chain()");
      expect(verifyRestored.rows[0].is_valid).toBe(true);
      expect(Number(verifyRestored.rows[0].broken_links)).toBe(0);
      expect(Number(verifyRestored.rows[0].hash_mismatches)).toBe(0);
    } finally {
      client.release();
    }
  });

  it("verifies consistent snapshot during concurrent writes without deadlocks", async () => {
    const WRITE_COUNT = 15;
    const writePromises = Array.from({ length: WRITE_COUNT }, (_, i) => {
      return (async () => {
        const client = await pool.connect();
        try {
          await client.query(`
            INSERT INTO audit_log (event_type, tenant_id, outcome, detail)
            VALUES ($1, 1, 'success', $2)
          `, [`concurrent.verify.write.${i}`, JSON.stringify({ i })]);
        } finally {
          client.release();
        }
      })();
    });

    // Verification runs in REPEATABLE READ snapshot isolation
    const verifyPromise = (async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        const res = await client.query("SELECT * FROM gnw_verify_audit_chain()");
        await client.query("COMMIT");
        return res.rows[0];
      } finally {
        client.release();
      }
    })();

    const [writes, verifyResult] = await Promise.all([
      Promise.all(writePromises),
      verifyPromise,
    ]);

    expect(writes.length).toBe(WRITE_COUNT);
    expect(verifyResult.is_valid).toBe(true);
    expect(Number(verifyResult.broken_links)).toBe(0);
    expect(Number(verifyResult.hash_mismatches)).toBe(0);

    const finalClient = await pool.connect();
    try {
      const finalRes = await finalClient.query("SELECT * FROM gnw_verify_audit_chain()");
      expect(finalRes.rows[0].is_valid).toBe(true);
      expect(Number(finalRes.rows[0].broken_links)).toBe(0);
      expect(Number(finalRes.rows[0].hash_mismatches)).toBe(0);
    } finally {
      finalClient.release();
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

      // Perform tamper inside a transactional block
      await client.query("BEGIN");
      await client.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only");
      await client.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_chain_insert");

      await client.query(`
        UPDATE audit_log
        SET detail = '{"tampered": true}'
        WHERE id = $1
      `, [canary.id]);

      const verifyRes = await client.query("SELECT * FROM gnw_verify_audit_chain()");
      const v = verifyRes.rows[0];
      expect(v.is_valid).toBe(false);
      expect(Number(v.hash_mismatches)).toBeGreaterThan(0);

      // Rollback cleanly so no permanent corruption occurs
      await client.query("ROLLBACK");

      const recheck = await client.query("SELECT * FROM gnw_verify_audit_chain()");
      expect(recheck.rows[0].is_valid).toBe(true);
      expect(Number(recheck.rows[0].broken_links)).toBe(0);
      expect(Number(recheck.rows[0].hash_mismatches)).toBe(0);
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

      // Perform link corruption inside a transactional block
      await client.query("BEGIN");
      await client.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only");
      await client.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_chain_insert");

      await client.query(`
        UPDATE audit_log
        SET prev_entry_hash = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
        WHERE id = $1
      `, [canary.id]);

      const verifyRes = await client.query("SELECT * FROM gnw_verify_audit_chain()");
      const v = verifyRes.rows[0];
      expect(v.is_valid).toBe(false);
      expect(Number(v.broken_links)).toBeGreaterThan(0);

      // Rollback cleanly
      await client.query("ROLLBACK");

      const recheck = await client.query("SELECT * FROM gnw_verify_audit_chain()");
      expect(recheck.rows[0].is_valid).toBe(true);
      expect(Number(recheck.rows[0].broken_links)).toBe(0);
      expect(Number(recheck.rows[0].hash_mismatches)).toBe(0);
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

      let updateRejected = false;
      try {
        await client.query("UPDATE audit_log SET outcome = 'failure' WHERE id = $1", [id]);
      } catch {
        updateRejected = true;
      }
      expect(updateRejected).toBe(true);

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

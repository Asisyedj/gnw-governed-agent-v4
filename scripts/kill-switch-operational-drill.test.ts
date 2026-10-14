import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { createTestApp } from "../src/tests/lib/testApp.js";
import { schema, withTenant, type Db } from "../src/server/db/index.js";

const { Pool } = pg;
const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error("TEST_DATABASE_URL is required for the disposable kill-switch drill");
const adminPool = new Pool({ connectionString: adminUrl });

let app: FastifyInstance;
let db: Db;
let tenantId: number | undefined;
let userId: number | undefined;
let sessionId: string | undefined;
let cookieHeader = "";
let startingGeneration = 0;

beforeAll(async () => {
  ({ app, db } = await createTestApp());

  const [tenant] = await db.insert(schema.tenants).values({
    slug: `kill-switch-drill-${randomUUID().slice(0, 8)}`,
    displayName: "Disposable Kill Switch Drill",
  }).returning({ id: schema.tenants.id });
  tenantId = tenant.id;

  const [user] = await withTenant(db, tenantId, tx =>
    tx.insert(schema.users).values({
      tenantId: tenantId!,
      email: `kill-switch-${randomUUID()}@example.test`,
      passwordHash: "test-only-password-hash",
      role: "owner",
    }).returning({ id: schema.users.id }),
  );
  userId = user.id;

  const rawToken = randomBytes(32).toString("hex");
  sessionId = randomUUID();
  await db.insert(schema.sessions).values({
    id: sessionId,
    userId,
    tenantId,
    tokenHash: createHash("sha256").update(rawToken).digest("hex"),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  cookieHeader = `session=${rawToken}`;

  const current = await db.select().from(schema.interlocks).orderBy(schema.interlocks.generation).limit(1);
  startingGeneration = current[0]?.generation ?? 0;
  await adminPool.query(
    "INSERT INTO interlocks (kill_switch, circuit_open, generation, reason) VALUES (false, false, $1, $2)",
    [startingGeneration + 1, "CI kill-switch drill starts fail-safe"],
  );
});

afterAll(async () => {
  // This direct reset is restricted to the throwaway CI database. The application
  // role cannot use this path to release the switch in a real deployment.
  const current = await adminPool.query("SELECT generation FROM interlocks ORDER BY generation DESC, id DESC LIMIT 1");
  const generation = Number(current.rows[0]?.generation ?? startingGeneration) + 1;
  await adminPool.query(
    "INSERT INTO interlocks (kill_switch, circuit_open, generation, reason) VALUES (false, false, $1, $2)",
    [generation, "CI kill-switch drill teardown"],
  );
  // Clear FK references from immutable interlock history before deleting the disposable test owner.
  if (userId) await adminPool.query("UPDATE interlocks SET updated_by_user_id = NULL WHERE updated_by_user_id = $1", [userId]);
  if (sessionId) await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
  if (userId && tenantId) {
    await withTenant(db, tenantId, tx => tx.delete(schema.users).where(eq(schema.users.id, userId!)));
  }
  if (tenantId) await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
  await app?.close();
  await adminPool.end();
});

describe("Authenticated kill-switch operational drill (disposable CI database)", () => {
  it("engages the global kill switch through the authenticated owner route", async () => {
    const denied = await app.inject({
      method: "POST",
      url: "/api/interlock/kill-switch",
      payload: { enabled: true, reason: "CI operational drill" },
    });
    expect(denied.statusCode).toBe(401);

    const res = await app.inject({
      method: "POST",
      url: "/api/interlock/kill-switch",
      headers: { cookie: cookieHeader },
      payload: { enabled: true, reason: "CI operational drill" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, interlock: { killSwitch: true } });
  });

  it("blocks governed mutations and reports readiness as degraded", async () => {
    const mutation = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: cookieHeader },
      payload: { title: "must be blocked while kill switch is engaged" },
    });
    expect(mutation.statusCode).toBe(503);
    expect(mutation.json()).toMatchObject({ code: "kill_switch" });

    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toMatchObject({
      status: "degraded",
      governedActionsReady: false,
      killSwitch: true,
    });
  });

  it("denies tenant-facing release attempts and records the security events", async () => {
    const postRelease = await app.inject({
      method: "POST",
      url: "/api/interlock/kill-switch",
      headers: { cookie: cookieHeader },
      payload: { enabled: false, reason: "negative release test" },
    });
    expect(postRelease.statusCode).toBe(403);
    expect(postRelease.json()).toMatchObject({ code: "platform_operator_dual_control_required" });

    const patchRelease = await app.inject({
      method: "PATCH",
      url: "/api/interlock",
      headers: { cookie: cookieHeader },
      payload: { killSwitch: false, circuitOpen: false },
    });
    expect(patchRelease.statusCode).toBe(403);
    expect(patchRelease.json()).toMatchObject({ code: "platform_operator_dual_control_required" });

    const rows = await withTenant(db, tenantId!, tx =>
      tx.select({ eventType: schema.auditLog.eventType, outcome: schema.auditLog.outcome })
        .from(schema.auditLog)
        .where(inArray(schema.auditLog.eventType, ["kill_switch.engage", "kill_switch.release_denied", "interlock.release_denied"])),
    );
    expect(rows.some(row => row.eventType === "kill_switch.engage" && row.outcome === "success")).toBe(true);
    expect(rows.some(row => row.eventType === "kill_switch.release_denied" && row.outcome === "denied")).toBe(true);
    expect(rows.some(row => row.eventType === "interlock.release_denied" && row.outcome === "denied")).toBe(true);
  });
});

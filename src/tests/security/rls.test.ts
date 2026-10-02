/**
 * PostgreSQL row-level security tests.
 * These tests exercise the actual database policy, not just HTTP authentication.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestApp } from "../lib/testApp.js";
import { schema, withTenant, type Db } from "../../server/db/index.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let db: Db;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

describe("RLS — cross-tenant isolation", () => {
  it("unauthenticated HTTP access is still denied", async () => {
    const [tasks, audit, approvals] = await Promise.all([
      app.inject({ method: "GET", url: "/api/tasks" }),
      app.inject({ method: "GET", url: "/api/audit" }),
      app.inject({ method: "GET", url: "/api/approvals" }),
    ]);
    expect(tasks.statusCode).toBe(401);
    expect(audit.statusCode).toBe(401);
    expect(approvals.statusCode).toBe(401);
  });

  it("enforces tenant isolation at the PostgreSQL row-policy boundary", async () => {
    const suffix = Date.now().toString();
    const [tenantA] = await db.insert(schema.tenants).values({ slug: "rls-a-" + suffix, displayName: "RLS A" }).returning();
    const [tenantB] = await db.insert(schema.tenants).values({ slug: "rls-b-" + suffix, displayName: "RLS B" }).returning();
    expect(tenantA).toBeTruthy();
    expect(tenantB).toBeTruthy();

    try {
      const [taskA] = await withTenant(db, tenantA!.id, async tx => tx.insert(schema.tasks).values({
        tenantId: tenantA!.id,
        title: "tenant-a-task",
      }).returning());
      const [taskB] = await withTenant(db, tenantB!.id, async tx => tx.insert(schema.tasks).values({
        tenantId: tenantB!.id,
        title: "tenant-b-task",
      }).returning());

      const visibleFromA = await withTenant(db, tenantA!.id, tx =>
        tx.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.id, taskB!.id)),
      );
      expect(visibleFromA).toHaveLength(0);

      const visibleFromB = await withTenant(db, tenantB!.id, tx =>
        tx.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.id, taskA!.id)),
      );
      expect(visibleFromB).toHaveLength(0);

      await expect(
        withTenant(db, tenantA!.id, tx =>
          tx.insert(schema.tasks).values({
            tenantId: tenantB!.id,
            title: "cross-tenant-write-must-fail",
          }).returning(),
        ),
      ).rejects.toThrow();

      const ownRows = await withTenant(db, tenantA!.id, tx =>
        tx.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.tenantId, tenantA!.id)),
      );
      expect(ownRows.map(row => row.id)).toContain(taskA!.id);
      expect(ownRows.map(row => row.id)).not.toContain(taskB!.id);
    } finally {
      await db.execute(sql`DELETE FROM tenants WHERE id IN (${tenantA!.id}, ${tenantB!.id})`);
    }
  });

  it("runs with a non-superuser, non-BYPASSRLS database role", async () => {
    const result = await db.execute(sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    const row = result.rows[0] as { rolsuper: boolean; rolbypassrls: boolean } | undefined;
    expect(row?.rolsuper).toBe(false);
    expect(row?.rolbypassrls).toBe(false);
  });

  it("fails closed when tenant context is absent", async () => {
    const rows = await db.select({ id: schema.tasks.id }).from(schema.tasks).limit(1);
    expect(rows).toHaveLength(0);
  });

  it("kill-switch activation requires authentication", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/interlock",
      payload: { killSwitch: true },
    });
    expect(res.statusCode).toBe(401);
  });
});

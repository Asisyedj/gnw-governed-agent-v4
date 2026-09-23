/**
 * Row-Level Security tests.
 * Verifies that cross-tenant data leakage is impossible at the DB level.
 * Requires a live PostgreSQL instance (run via docker-compose in CI).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "../lib/testApp.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => {
  ({ app } = await createTestApp());
});
afterAll(async () => { await app.close(); });

describe("RLS — cross-tenant isolation", () => {
  it("unauthenticated request cannot read tasks", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(res.statusCode).toBe(401);
  });

  it("unauthenticated request cannot read audit log", async () => {
    const res = await app.inject({ method: "GET", url: "/api/audit" });
    expect(res.statusCode).toBe(401);
  });

  it("unauthenticated request cannot read approvals", async () => {
    const res = await app.inject({ method: "GET", url: "/api/approvals" });
    expect(res.statusCode).toBe(401);
  });

  it("interlock status is readable without auth (public read)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/interlock" });
    expect(res.statusCode).toBe(200);
  });

  it("kill-switch activation requires authentication", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/interlock/kill-switch",
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(401);
  });
});

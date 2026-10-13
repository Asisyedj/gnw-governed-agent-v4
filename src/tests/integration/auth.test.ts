import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "../lib/testApp.js";
import type { FastifyInstance } from "fastify";
import type { Db } from "../../server/db/index.js";

let app: FastifyInstance;
let db: Db;

beforeAll(async () => { ({ app, db } = await createTestApp()); });
afterAll(async () => { await app.close(); });

describe("Auth routes", () => {
  it("POST /api/auth/register — fails closed when public registration is disabled", async () => {
    const tenantSlug = `blocked-tenant-${Date.now()}`;
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: `blocked-${Date.now()}@example.com`, password: "StrongP@ss1!", tenantSlug },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "registration_closed" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("POST /api/auth/login — wrong password returns 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nobody@example.com", password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/me — unauthenticated returns 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "../lib/testApp.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => { ({ app } = await createTestApp()); });
afterAll(async () => { await app.close(); });

describe("Approvals — unauthenticated", () => {
  it("GET /api/approvals — returns 401 without session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/approvals" });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/approvals/:id/approve — returns 401 without session", async () => {
    const res = await app.inject({ method: "POST", url: "/api/approvals/999/approve", payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

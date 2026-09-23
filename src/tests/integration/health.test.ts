import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "../lib/testApp.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => { ({ app } = await createTestApp()); });
afterAll(async () => { await app.close(); });

describe("GET /api/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBeDefined();
  });

  it("returns 200 on /api/ready", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ready" });
    expect(res.statusCode).toBe(200);
  });
});

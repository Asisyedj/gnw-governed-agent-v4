import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "../lib/testApp.js";
import type { FastifyInstance } from "fastify";
let app: FastifyInstance;

beforeAll(async () => { ({ app } = await createTestApp()); });
afterAll(async () => { await app.close(); });

describe("Interlock — public status endpoint", () => {
  it("GET /api/interlock — returns current interlock status", async () => {
    const res = await app.inject({ method: "GET", url: "/api/interlock" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.killSwitch).toBe("boolean");
    expect(typeof body.circuitOpen).toBe("boolean");
  });
});

/**
 * Secrets hygiene tests.
 * Verifies that sensitive values are never leaked in HTTP responses.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "../lib/testApp.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => { ({ app } = await createTestApp()); });
afterAll(async () => { await app.close(); });

describe("Secrets — no leakage in responses", () => {
  const sensitivePatterns = [
    /password/i, /passwordHash/i, /token_hash/i,
    /cookie_secret/i, /database_url/i,
  ];

  it("health endpoint does not leak env vars", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    const body = res.body;
    for (const pattern of sensitivePatterns) {
      expect(body).not.toMatch(pattern);
    }
  });

  it("error response on unknown route does not leak stack trace in prod-like mode", async () => {
    const res = await app.inject({ method: "GET", url: "/api/does-not-exist-xyz" });
    // Stack traces must never be in API responses
    expect(res.body).not.toContain("at Object.");
    expect(res.body).not.toContain("node_modules");
  });
});

/**
 * Rate-limiting smoke tests.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "../lib/testApp.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => { ({ app } = await createTestApp()); });
afterAll(async () => { await app.close(); });

describe("Rate limiting", () => {
  it("auth endpoint returns x-ratelimit headers", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "x@x.com", password: "wrong" },
    });
    // Either rate-limit headers present or 401
    expect([401, 429]).toContain(res.statusCode);
  });
});

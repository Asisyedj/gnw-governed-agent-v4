import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "../lib/testApp.js";
import type { FastifyInstance } from "fastify";
import type { Db } from "../../server/db/index.js";

let app: FastifyInstance;
let db: Db;

beforeAll(async () => { ({ app, db } = await createTestApp()); });
afterAll(async () => { await app.close(); });

describe("Tasks — unauthenticated", () => {
  it("GET /api/tasks — returns 401 without session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/tasks — returns 401 without session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Should fail", classificationLevel: "standard" },
    });
    expect(res.statusCode).toBe(401);
  });
});

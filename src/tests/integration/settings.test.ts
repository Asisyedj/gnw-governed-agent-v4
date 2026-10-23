import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp } from "../lib/testApp.js";
import { schema, withTenant, type Db } from "../../server/db/index.js";
import { createSession, deleteSession } from "../../server/repo.js";

let app: FastifyInstance;
let db: Db;
let tenantId: number;
let userId: number;
let sessionId: string;
let cookieHeader: string;
let apiKeyBefore: string | undefined;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  apiKeyBefore = process.env.LLM_API_KEY;

  const [tenant] = await db.insert(schema.tenants).values({
    slug: `settings-test-${randomUUID().slice(0, 8)}`,
    displayName: "Settings Security Test",
  }).returning({ id: schema.tenants.id });
  if (!tenant) throw new Error("Failed to create settings test tenant");
  tenantId = tenant.id;

  const [user] = await withTenant(db, tenantId, tx =>
    tx.insert(schema.users).values({
      tenantId,
      email: `settings-${randomUUID()}@example.test`,
      passwordHash: "test-only-password-hash",
      role: "owner",
    }).returning({ id: schema.users.id }),
  );
  if (!user) throw new Error("Failed to create settings test user");
  userId = user.id;

  const rawToken = randomBytes(32).toString("hex");
  const session = await createSession(
    db,
    userId,
    tenantId,
    createHash("sha256").update(rawToken).digest("hex"),
    new Date(Date.now() + 60 * 60 * 1000),
  );
  sessionId = session.id;
  cookieHeader = `session=${rawToken}`;
});

afterAll(async () => {
  if (sessionId && tenantId) await deleteSession(db, sessionId, tenantId);
  if (userId && tenantId) {
    await withTenant(db, tenantId, tx => tx.delete(schema.users).where(eq(schema.users.id, userId)));
  }
  if (tenantId) await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
  await app?.close();
});

describe("Settings security boundary", () => {
  it("rejects unauthenticated runtime writes", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/settings", payload: { apiKey: "not-a-real-secret" } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "unauthenticated" });
  });

  it("rejects runtime model/key writes without changing process credentials", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { cookie: cookieHeader },
      payload: { model: "meta/llama-3.2-11b-vision-instruct", apiKey: "not-a-real-secret" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, code: "settings_managed_externally" });
    expect(process.env.LLM_API_KEY).toBe(apiKeyBefore);
  });

  it("rejects arbitrary model names and oversized prompts before making any upstream request", async () => {
    const invalidModel = await app.inject({
      method: "POST",
      url: "/api/settings/test",
      headers: { cookie: cookieHeader },
      payload: { model: "https://invalid.example/model", prompt: "hello" },
    });
    expect(invalidModel.statusCode).toBe(400);
    expect(invalidModel.json()).toMatchObject({ code: "invalid_input" });

    const oversizedPrompt = await app.inject({
      method: "POST",
      url: "/api/settings/test",
      headers: { cookie: cookieHeader },
      payload: { model: "meta/llama-3.2-11b-vision-instruct", prompt: "x".repeat(2001) },
    });
    expect(oversizedPrompt.statusCode).toBe(400);
    expect(oversizedPrompt.json()).toMatchObject({ code: "invalid_input" });
  });

  it("exposes only credential presence rather than a credential value", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.settingsManagedExternally).toBe(true);
    expect(["configured", "none"]).toContain(body.maskedApiKey);
    expect(body.maskedApiKey).not.toBe(process.env.LLM_API_KEY);
  });
});

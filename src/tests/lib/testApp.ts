/**
 * Shared test application factory.
 * Creates a fully initialised Fastify app connected to the test database.
 */
import { buildApp } from "../../server/app.js";
import type { FastifyInstance } from "fastify";
import type { Db } from "../../server/db/index.js";

// Minimal env for tests — must be set BEFORE buildApp() is called
process.env.NODE_ENV      = "test";
process.env.DATABASE_URL  = process.env.DATABASE_URL ?? "postgresql://gnw:gnw_test_pw@localhost:5432/gnw_test";
process.env.COOKIE_SECRET = "test-cookie-secret-minimum-32-characters-ok";
process.env.LOG_LEVEL     = "silent";

export async function createTestApp(): Promise<{ app: FastifyInstance; db: Db }> {
  const { app, db } = await buildApp();
  await app.ready();
  return { app, db };
}

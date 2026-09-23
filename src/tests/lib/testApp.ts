import { buildApp } from "../../server/app.js";

// Minimal env for tests
process.env.NODE_ENV        = "test";
process.env.DATABASE_URL    = process.env.DATABASE_URL ?? "postgresql://gnw:gnw@localhost:5432/gnw_test";
process.env.COOKIE_SECRET   = "test-cookie-secret-minimum-32-characters-ok";
process.env.LOG_LEVEL       = "silent";

export async function createTestApp() {
  const { app, db } = await buildApp();
  await app.ready();
  return { app, db };
}

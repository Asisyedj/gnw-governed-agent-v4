import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;

export function getDb(databaseUrl?: string): Db {
  if (_db) return _db;
  const url = databaseUrl ?? process.env.DATABASE_URL ?? "file:./data/gnw.db";
  const path = url.replace(/^file:/, "");
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");
  _db = drizzle(sqlite, { schema });
  return _db;
}

export async function runMigrations(): Promise<void> {
  const db = getDb();
  const sqlite = (db as { _client?: InstanceType<typeof Database> })._client;
  if (!sqlite) return;
  // Push schema via migrate
  try {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const path = await import("node:path");
    const url = await import("node:url");
    const migrationsFolder = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../../migrations");
    migrate(db, { migrationsFolder });
    console.log("[db] migrations applied");
  } catch {
    console.warn("[db] migrations folder not found, using push mode");
    db.run(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
  }
}

export { schema };

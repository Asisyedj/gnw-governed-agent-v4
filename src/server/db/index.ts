import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL environment variable is required.");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DATABASE_SSL === "false" ? false
    : process.env.NODE_ENV === "production" ? { rejectUnauthorized: true }
    : false,
});

pool.on("error", (err) => {
  console.error("Unexpected pg pool error", err);
});

export const db = drizzle(pool, { schema, logger: process.env.NODE_ENV !== "production" });
export type Db = typeof db;

export function createDb() { return db; }
export { schema };

export async function closeDb() {
  await pool.end();
}

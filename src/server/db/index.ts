import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL environment variable is required.");

const isProduction = process.env.NODE_ENV === "production";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DATABASE_SSL === "false" ? false : isProduction ? { rejectUnauthorized: true } : false,
  application_name: "gnw-governed-agent",
});

pool.on("error", err => console.error("Unexpected pg pool error", err));

export const db = drizzle(pool, { schema, logger: !isProduction });
export type Db = typeof db;
export type TenantTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function withTenant<T>(tenantId: number, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error("invalid_tenant_context");
  return db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${String(tenantId)}, true)`);
    return fn(tx);
  });
}

export function createDb() { return db; }
export { schema };

export async function closeDb() { await pool.end(); }

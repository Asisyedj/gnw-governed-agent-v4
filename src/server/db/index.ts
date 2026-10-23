import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";
import { assertProductionPostgresTls } from "./ssl-policy.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL environment variable is required.");

const isProduction = process.env.NODE_ENV === "production";
const postgresSslRequired = process.env.GNW_POSTGRES_SSL_REQUIRED === "true";
const parsedDatabaseUrl = new URL(databaseUrl);
if (isProduction || postgresSslRequired) {
  assertProductionPostgresTls(databaseUrl, process.env.GNW_POSTGRES_SSL_REQUIRED);
}

// Do not pass an independent ssl object when URL TLS parameters exist: node-postgres
// parses sslmode/sslrootcert from the URL and those parameters otherwise override ssl config.
const tlsConnectionParams = ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"];
const urlOwnsTlsPolicy = tlsConnectionParams.some(name => parsedDatabaseUrl.searchParams.has(name));
const pool = new Pool({
  connectionString: databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ...(urlOwnsTlsPolicy ? {} : { ssl: postgresSslRequired ? { rejectUnauthorized: true } : false }),
});
pool.on("error", err => console.error("Unexpected pg pool error", err));
export const db = drizzle(pool, { schema, logger: process.env.NODE_ENV !== "production" });
export type Db = typeof db;
export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function withTenant<T>(database: Db, tenantId: number, fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error("invalid_tenant_context");
  return database.transaction(async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${String(tenantId)}, true)`);
    return fn(tx);
  });
}
export function createDb() { return db; }
export { schema };
export async function closeDb() { await pool.end(); }

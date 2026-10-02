import pg from "pg";
const { Pool } = pg;

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const appUser = process.env.GNW_APP_DB_USER ?? "gnw_app";
const appPassword = process.env.GNW_APP_DB_PASSWORD;

if (!migrationUrl) throw new Error("MIGRATION_DATABASE_URL is required");
if (!appUser || !appPassword) throw new Error("GNW_APP_DB_USER and GNW_APP_DB_PASSWORD are required");

const ident = value => '"' + value.replace(/"/g, '""') + '"';
const literal = value => "'" + value.replace(/'/g, "''") + "'";
const pool = new Pool({
  connectionString: migrationUrl,
  ssl: process.env.GNW_POSTGRES_SSL_REQUIRED === "true" ? { rejectUnauthorized: true } : false,
});

const client = await pool.connect();
try {
  const dbName = (await client.query("select current_database() as name")).rows[0]?.name;
  const roleExists = await client.query("select 1 from pg_roles where rolname = $1", [appUser]);
  if (!roleExists.rowCount) {
    await client.query(`CREATE ROLE ${ident(appUser)} LOGIN PASSWORD ${literal(appPassword)} NOSUPERUSER NOBYPASSRLS`);
  } else {
    await client.query(`ALTER ROLE ${ident(appUser)} LOGIN PASSWORD ${literal(appPassword)} NOSUPERUSER NOBYPASSRLS`);
  }
  await client.query(`GRANT CONNECT ON DATABASE ${ident(dbName)} TO ${ident(appUser)}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${ident(appUser)}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ident(appUser)}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ident(appUser)}`);
  const adminRole = (await client.query("select current_user as role")).rows[0]?.role;
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(adminRole)} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ident(appUser)}`);
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(adminRole)} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ident(appUser)}`);
  const role = (await client.query("select rolsuper, rolbypassrls from pg_roles where rolname = $1", [appUser])).rows[0];
  if (!role || role.rolsuper || role.rolbypassrls) throw new Error("runtime database role is not RLS-restricted");
  console.log(`Provisioned restricted database role: ${appUser}`);
} finally {
  client.release();
  await pool.end();
}

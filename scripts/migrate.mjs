import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
const databaseUrl=process.env.DATABASE_URL;if(!databaseUrl)throw new Error("DATABASE_URL is required");
const root=dirname(dirname(fileURLToPath(import.meta.url))),dir=join(root,"drizzle");
const files=(await readdir(dir)).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort();
const client=new Client({connectionString:databaseUrl,ssl:process.env.GNW_POSTGRES_SSL_REQUIRED==="true"?{rejectUnauthorized:true}:false});await client.connect();
try{await client.query("BEGIN");await client.query("CREATE TABLE IF NOT EXISTS gnw_schema_migrations (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");for(const file of files){const id=basename(file,".sql"),sql=await readFile(join(dir,file),"utf8"),sha=createHash("sha256").update(sql).digest("hex"),existing=await client.query("SELECT sha256 FROM gnw_schema_migrations WHERE id=$1",[id]);if(existing.rowCount){if(existing.rows[0].sha256!==sha)throw new Error(`Migration checksum drift: ${id}`);continue;}await client.query(sql);await client.query("INSERT INTO gnw_schema_migrations(id,sha256) VALUES($1,$2)",[id,sha]);console.log(`[migration] applied ${id}`);}await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{await client.end();}
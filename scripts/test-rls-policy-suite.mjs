#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
const { Pool } = pg;
const outputPath = resolve(process.cwd(), process.env.GNW_RLS_EVIDENCE_PATH || 'rls-policy-suite-results.json');
const tables = ['users','sessions','tasks','task_steps','approvals','budget_reservations','audit_log','capability_leases','artifacts'];
const constraints = ['sessions_user_same_tenant_fk','tasks_creator_same_tenant_fk','task_steps_task_same_tenant_fk','approvals_task_same_tenant_fk','approvals_requester_same_tenant_fk','approvals_reviewer_same_tenant_fk','budget_task_same_tenant_fk','artifacts_task_same_tenant_fk','artifacts_step_same_tenant_fk','capability_task_same_tenant_fk','capability_actor_same_tenant_fk'];
const checks = [];
let failure;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (process.env.NODE_ENV !== 'test' && !(process.env.GNW_ENVIRONMENT === 'staging' && process.env.GNW_ALLOW_STAGING_RLS_TESTS === 'true')) throw new Error('RLS policy suite only runs in test or explicit staging opt-in');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.GNW_POSTGRES_SSL_REQUIRED === 'true' ? { rejectUnauthorized: true } : false, connectionTimeoutMillis: 10000, max: 2 });
function check(name, passed, detail) { checks.push({ name, status: passed ? 'PASS' : 'FAIL', detail }); if (!passed) throw new Error(name + ': ' + detail); }
async function main() {
  const child = spawnSync(process.execPath, ['scripts/test-rls.mjs'], { env: process.env, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  check('RLS-SEMANTIC-DML', child.status === 0 && !child.error, child.status === 0 ? 'cross-tenant DML test completed' : (child.error?.message || child.stderr || 'semantic test failed'));
  const role = (await pool.query("SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create FROM pg_roles WHERE rolname = current_user")).rows[0];
  check('RLS-ROLE-EXISTS', Boolean(role), 'current database role is introspectable');
  check('RLS-ROLE-PRIVILEGES', role && !role.rolsuper && !role.rolbypassrls && !role.rolcreaterole && !role.rolcreatedb && !role.schema_create, 'runtime role must not be superuser, BYPASSRLS, create roles, create databases, or create schema objects');
  const found = await pool.query("SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname = ANY($1::text[])", [tables]);
  const byName = new Map(found.rows.map((r) => [r.relname, r]));
  check('RLS-TABLE-COVERAGE', tables.every((name) => byName.has(name)), 'all required tenant tables must exist');
  for (const name of tables) { const row = byName.get(name); check('RLS-ENABLED-' + name, Boolean(row?.relrowsecurity), 'RLS enabled'); check('RLS-FORCED-' + name, Boolean(row?.relforcerowsecurity), 'FORCE ROW LEVEL SECURITY enabled'); }
  const policies = await pool.query("SELECT tablename, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename = ANY($1::text[])", [tables]);
  for (const name of tables) check('RLS-POLICY-' + name, policies.rows.some((p) => p.tablename === name && (p.qual || p.with_check)), 'at least one tenant isolation policy with predicate exists');
  const foundConstraints = await pool.query('SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])', [constraints]);
  const names = new Set(foundConstraints.rows.map((r) => r.conname));
  check('RLS-COMPOSITE-FK-COVERAGE', constraints.every((name) => names.has(name)), 'all required composite tenant foreign keys exist');
  const privileges = (await pool.query("SELECT has_table_privilege(current_user,'public.audit_log','UPDATE') AS au, has_table_privilege(current_user,'public.audit_log','DELETE') AS ad, has_table_privilege(current_user,'public.nonces','UPDATE') AS nu, has_table_privilege(current_user,'public.nonces','DELETE') AS nd, has_table_privilege(current_user,'public.interlocks','UPDATE') AS iu, has_table_privilege(current_user,'public.interlocks','DELETE') AS id")).rows[0];
  check('RLS-IMMUTABLE-LEDGERS', privileges && !privileges.au && !privileges.ad && !privileges.nu && !privileges.nd && !privileges.iu && !privileges.id, 'runtime role cannot update/delete audit, nonce, or interlock rows');
}
try { await main(); } catch (error) { failure = error instanceof Error ? error.message : String(error); checks.push({ name: 'RLS-SUITE-EXECUTION', status: 'FAIL', detail: failure }); }
await pool.end();
await mkdir(resolve(outputPath, '..'), { recursive: true });
await writeFile(outputPath, JSON.stringify({ schemaVersion: 1, suite: 'GNW RLS Policy Suite', status: failure ? 'FAIL' : 'PASS', timestamp: new Date().toISOString(), checks, ...(failure ? { error: failure } : {}) }, null, 2) + '\n', { mode: 0o600 });
if (failure) { console.error('RLS policy suite FAIL:', failure); process.exitCode = 1; } else console.log('RLS policy suite PASS (' + checks.length + ' checks)');

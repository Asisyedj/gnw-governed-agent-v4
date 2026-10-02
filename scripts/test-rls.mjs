import pg from 'pg';
const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.GNW_POSTGRES_SSL_REQUIRED === 'true' ? { rejectUnauthorized: true } : false,
});
const q = async (sql, args=[]) => (await pool.query(sql,args)).rows;
try {
  const t1 = (await q('INSERT INTO tenants(slug,display_name) VALUES($1,$2) RETURNING id',['rls-a','RLS A']))[0].id;
  const t2 = (await q('INSERT INTO tenants(slug,display_name) VALUES($1,$2) RETURNING id',['rls-b','RLS B']))[0].id;
  const a = await pool.connect();
  const b = await pool.connect();
  try {
    await a.query('BEGIN');
    await a.query('SELECT set_config(\'app.tenant_id\',$1,true)', [String(t1)]);
    const u = await a.query('INSERT INTO users(tenant_id,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[t1,'a@example.test','x','owner']);
    await a.query('INSERT INTO tasks(tenant_id,created_by_user_id,title) VALUES($1,$2,$3)',[t1,u.rows[0].id,'tenant-a']);
    await a.query('COMMIT');
    await b.query('BEGIN');
    await b.query('SELECT set_config(\'app.tenant_id\',$1,true)', [String(t2)]);
    const hidden = await b.query('SELECT id FROM tasks WHERE tenant_id=$1',[t1]);
    if (hidden.rowCount !== 0) throw new Error('cross-tenant SELECT leak');
    let insertDenied = false;
    try { await b.query('INSERT INTO tasks(tenant_id,title) VALUES($1,$2)',[t1,'cross-tenant']); } catch { insertDenied = true; }
    if (!insertDenied) throw new Error('cross-tenant INSERT was allowed');
    await b.query('ROLLBACK');
    await b.query('BEGIN');
    await b.query('SELECT set_config('app.tenant_id',$1,true)', [String(t2)]);
    await b.query('INSERT INTO users(tenant_id,email,password_hash,role) VALUES($1,$2,$3,$4)',[t2,'b@example.test','x','owner']);
    await b.query('COMMIT');
  } finally { a.release(); b.release(); }
  const tables = ['users','tasks','task_steps','approvals','budget_reservations','audit_log','capability_leases','artifacts'];
  const rlsRows = await q('SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=\'public\' AND c.relname = ANY($1::text[])',[tables]);
  if (rlsRows.length !== tables.length) throw new Error('RLS table set incomplete');
  for (const row of rlsRows) if (!row.relrowsecurity || !row.relforcerowsecurity) throw new Error('RLS not forced on ' + row.relname);
  const policies = await q('SELECT tablename,policyname FROM pg_policies WHERE schemaname=\'public\' AND policyname LIKE \'gnw_%\'');
  if (policies.length < 8) throw new Error('expected tenant RLS policies missing');
  console.log(JSON.stringify({ ok:true, tenantCount:2, policyCount:policies.length, rlsTables:rlsRows.length }));
} finally { await pool.end(); }

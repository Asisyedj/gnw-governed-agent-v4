import pg from 'pg';

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.GNW_POSTGRES_SSL_REQUIRED === 'true' ? { rejectUnauthorized: true } : false,
});

const q = async (clientOrSql, maybeSql, maybeArgs=[]) => {
  if (typeof clientOrSql === 'string') return (await pool.query(clientOrSql, maybeSql ?? [])).rows;
  return (await clientOrSql.query(maybeSql, maybeArgs)).rows;
};

try {
  const role = (await q(
    'SELECT current_user,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user'
  ))[0];
  if (!role) throw new Error('database role introspection failed');
  if (role.rolsuper || role.rolbypassrls) throw new Error('application role bypasses RLS or is superuser');
  if (role.rolcreaterole || role.rolcreatedb) throw new Error('application role has excessive database privileges');

  const suffix = Date.now().toString(36);
  const t1 = (await q(
    'INSERT INTO tenants(slug,display_name) VALUES($1,$2) RETURNING id',
    ['rls-a-' + suffix, 'RLS A']
  ))[0].id;
  const t2 = (await q(
    'INSERT INTO tenants(slug,display_name) VALUES($1,$2) RETURNING id',
    ['rls-b-' + suffix, 'RLS B']
  ))[0].id;

  const a = await pool.connect();
  const b = await pool.connect();
  try {
    await a.query('BEGIN');
    await a.query('SELECT set_config(\'app.tenant_id\',$1,true)', [String(t1)]);
    const setting = (await a.query("SELECT current_setting('app.tenant_id', true) AS tenant_id")) .rows[0]?.tenant_id;
    if (String(setting) !== String(t1)) throw new Error('tenant context not established for tenant-a transaction');
    const policy = (await a.query("SELECT policyname, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='tasks'")).rows;
    if (!policy.length) throw new Error('tasks RLS policy missing at runtime');
    const u1 = (await a.query(
      'INSERT INTO users(tenant_id,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',
      [t1,'a@example.test','x','owner']
    )).rows[0];
    await a.query(
      'INSERT INTO tasks(tenant_id,created_by_user_id,title) VALUES($1,$2,$3)',
      [t1,u1.id,'tenant-a']
    );
    await a.query('COMMIT');

    await b.query('BEGIN');
    await b.query('SELECT set_config(\'app.tenant_id\',$1,true)', [String(t2)]);

    const hidden = await b.query('SELECT id FROM tasks WHERE tenant_id=$1',[t1]);
    if (hidden.rowCount !== 0) throw new Error('cross-tenant SELECT leak');

    let updateDenied = false;
    try { await b.query('UPDATE tasks SET title=$1 WHERE tenant_id=$2',['cross-tenant-update',t1]); }
    catch { updateDenied = true; }
    if (!updateDenied) {
      const changed = await b.query('SELECT id FROM tasks WHERE title=$1',['cross-tenant-update']);
      if (changed.rowCount !== 0) throw new Error('cross-tenant UPDATE unexpectedly changed a row');
    }

    let deleteDenied = false;
    try { await b.query('DELETE FROM tasks WHERE tenant_id=$1',[t1]); }
    catch { deleteDenied = true; }
    if (!deleteDenied) {
      const stillThere = await b.query('SELECT id FROM tasks WHERE title=$1',['tenant-a']);
      if (stillThere.rowCount !== 0) throw new Error('cross-tenant DELETE unexpectedly changed a row');
    }

    let insertDenied = false;
    try { await b.query('INSERT INTO tasks(tenant_id,title) VALUES($1,$2)',[t1,'cross-tenant-insert']); }
    catch { insertDenied = true; }
    if (!insertDenied) throw new Error('cross-tenant INSERT was allowed');

    await b.query('ROLLBACK');

    await b.query('BEGIN');
    const leakedAfterCommit = await b.query('SELECT id FROM tasks');
    if (leakedAfterCommit.rowCount !== 0) throw new Error('tenant context leaked across transaction boundary');
    await b.query('SELECT set_config(\'app.tenant_id\',$1,true)', [String(t2)]);
    const u2 = (await b.query(
      'INSERT INTO users(tenant_id,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',
      [t2,'b@example.test','x','owner']
    )).rows[0];

    let compositeMismatchDenied = false;
    try {
      await b.query(
        'INSERT INTO tasks(tenant_id,created_by_user_id,title) VALUES($1,$2,$3)',
        [t2,u1.id,'mismatched-user']
      );
    } catch { compositeMismatchDenied = true; }
    if (!compositeMismatchDenied) throw new Error('cross-tenant composite foreign key was bypassed');

    await b.query('COMMIT');
    if (!u2?.id) throw new Error('tenant-b user creation failed');
  } finally {
    a.release();
    b.release();
  }

  const tables = ['users','tasks','task_steps','approvals','budget_reservations','audit_log','capability_leases','artifacts'];
  const rlsRows = await q(
    'SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=\'public\' AND c.relname = ANY($1::text[])',
    [tables]
  );
  if (rlsRows.length !== tables.length) throw new Error('RLS table set incomplete');
  for (const row of rlsRows) {
    if (!row.relrowsecurity || !row.relforcerowsecurity) throw new Error('RLS not forced on ' + row.relname);
  }

  const policies = await q(
    'SELECT tablename,policyname FROM pg_policies WHERE schemaname=\'public\' AND tablename = ANY($1::text[])',
    [tables]
  );
  const byTable = new Set(policies.map(row => row.tablename));
  if (byTable.size !== tables.length) throw new Error('expected tenant RLS policies missing');

  const constraintNames = [
    'sessions_user_same_tenant_fk',
    'tasks_creator_same_tenant_fk',
    'task_steps_task_same_tenant_fk',
    'approvals_task_same_tenant_fk',
    'approvals_requester_same_tenant_fk',
    'approvals_reviewer_same_tenant_fk',
    'budget_task_same_tenant_fk',
    'artifacts_task_same_tenant_fk',
    'artifacts_step_same_tenant_fk',
    'capability_task_same_tenant_fk',
    'capability_actor_same_tenant_fk'
  ];
  const constraints = await q(
    'SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])',
    [constraintNames]
  );
  if (new Set(constraints.map(row => row.conname)).size !== constraintNames.length) {
    throw new Error('composite tenant foreign-key set incomplete');
  }

  console.log(JSON.stringify({
    ok:true,
    tenantCount:2,
    policyCount:policies.length,
    rlsTables:rlsRows.length,
    compositeTenantConstraints:constraints.length,
    role:{
      superuser:Boolean(role.rolsuper),
      bypassRls:Boolean(role.rolbypassrls),
      createRole:Boolean(role.rolcreaterole),
      createDb:Boolean(role.rolcreatedb)
    }
  }));
} finally {
  await pool.end();
}
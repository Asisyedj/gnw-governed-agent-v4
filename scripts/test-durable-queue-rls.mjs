import pg from "pg";
const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.GNW_POSTGRES_SSL_REQUIRED==="true"?{rejectUnauthorized:true}:false});
const assert=(condition,msg)=>{if(!condition)throw new Error(msg);};
try {
  const role=(await pool.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert(role && !role.rolsuper && !role.rolbypassrls,"test must run as non-superuser app role without BYPASSRLS");
  const suffix=Date.now().toString(36);
  const t1=(await pool.query("INSERT INTO tenants(slug,display_name) VALUES($1,$2) RETURNING id",["queue-rls-a-"+suffix,"Queue RLS A"])).rows[0].id;
  const t2=(await pool.query("INSERT INTO tenants(slug,display_name) VALUES($1,$2) RETURNING id",["queue-rls-b-"+suffix,"Queue RLS B"])).rows[0].id;
  const a=await pool.connect(), b=await pool.connect();
  try {
    await a.query("BEGIN"); await a.query("SELECT set_config('app.tenant_id',$1,true)",[String(t1)]);
    const inserted=await a.query(`INSERT INTO job_queue(tenant_id,job_type,payload,payload_digest,idempotency_key)
      VALUES($1,'test.noop','{"test":true}'::jsonb,$2,$3) RETURNING id`,[t1,"a".repeat(64),"queue-test-"+suffix]);
    assert(inserted.rowCount===1,"tenant A queue insert failed");
    await a.query("COMMIT");
    await b.query("BEGIN"); await b.query("SELECT set_config('app.tenant_id',$1,true)",[String(t2)]);
    const hidden=await b.query("SELECT id FROM job_queue WHERE tenant_id=$1",[t1]);
    assert(hidden.rowCount===0,"cross-tenant job read leak");
    let denied=false;
    try { await b.query("INSERT INTO job_queue(tenant_id,job_type,payload,payload_digest,idempotency_key) VALUES($1,'test.noop','{}'::jsonb,$2,$3)",[t1,"b".repeat(64),"cross-"+suffix]); } catch { denied=true; }
    assert(denied,"cross-tenant job insert allowed");
    await b.query("ROLLBACK");
    await b.query("BEGIN");
    const missing=await b.query("SELECT id FROM job_queue");
    assert(missing.rowCount===0,"tenant context missing but rows visible");
    await b.query("ROLLBACK");
  } finally { a.release(); b.release(); }
  console.log("PASS durable queue RLS: cross-tenant read/write blocked; missing context sees no rows");
} finally { await pool.end(); }

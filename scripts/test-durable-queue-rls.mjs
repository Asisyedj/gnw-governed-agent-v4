import pg from "pg";
import { claimJob, enqueueJob, finishJob, heartbeatJob, jobCancellationRequested, acknowledgeCancelledJob, requestJobCancellation, recoverExpiredJobs } from "../src/server/orchestration/durable-queue.ts";
import { digestQueuePayload } from "../src/server/orchestration/queue-payload.ts";

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.GNW_POSTGRES_SSL_REQUIRED==="true"?{rejectUnauthorized:true}:false,
});
const assert=(condition,msg)=>{if(!condition)throw new Error(msg);};
const expectedDigest=(payload)=>digestQueuePayload(payload);
const runId=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;

try {
  const role=(await pool.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert(role && !role.rolsuper && !role.rolbypassrls,"test must run as non-superuser app role without BYPASSRLS");
  const t1=(await pool.query("INSERT INTO tenants(slug,display_name) VALUES($1,$2) RETURNING id",[`queue-rls-a-${runId}`,"Queue RLS A"])).rows[0].id;
  const t2=(await pool.query("INSERT INTO tenants(slug,display_name) VALUES($1,$2) RETURNING id",[`queue-rls-b-${runId}`,"Queue RLS B"])).rows[0].id;

  const a=await pool.connect(), b=await pool.connect();
  let crossTenantJobId;
  try {
    await a.query("BEGIN");
    await a.query("SELECT set_config('app.tenant_id',$1,true)",[String(t1)]);
    const inserted=await a.query(`INSERT INTO job_queue(tenant_id,job_type,payload,payload_digest,idempotency_key)
      VALUES($1,'test.noop','{"test":true}'::jsonb,$2,$3) RETURNING id`,[t1,"a".repeat(64),`queue-test-cross-${runId}`]);
    assert(inserted.rowCount===1,"tenant A queue insert failed");
    crossTenantJobId=inserted.rows[0].id;
    await a.query("COMMIT");

    await b.query("BEGIN"); await b.query("SELECT set_config('app.tenant_id',$1,true)",[String(t2)]);
    const hidden=await b.query("SELECT id FROM job_queue WHERE tenant_id=$1",[t1]);
    assert(hidden.rowCount===0,"cross-tenant job read leak");
    let denied=false;
    try { await b.query("INSERT INTO job_queue(tenant_id,job_type,payload,payload_digest,idempotency_key) VALUES($1,'test.noop','{}'::jsonb,$2,$3)",[t1,"b".repeat(64),`cross-${runId}`]); } catch { denied=true; }
    assert(denied,"cross-tenant job insert allowed");
    await b.query("ROLLBACK");
    await b.query("BEGIN");
    const missing=await b.query("SELECT id FROM job_queue");
    assert(missing.rowCount===0,"tenant context missing but rows visible");
    await b.query("ROLLBACK");
  } finally { a.release(); b.release(); }

  const firstPayload={tenantId:t1,taskId:101,actorId:11,requestId:`worker-${runId}-1`};
  const secondPayload={tenantId:t1,taskId:102,actorId:12,requestId:`worker-${runId}-2`};
  const [first,duplicate,second]=await Promise.all([
    enqueueJob(pool,{tenantId:t1,jobType:"test.lease",payload:firstPayload,payloadDigest:expectedDigest(firstPayload),idempotencyKey:`lease-1-${runId}`,maxAttempts:3}),
    enqueueJob(pool,{tenantId:t1,jobType:"test.lease",payload:firstPayload,payloadDigest:expectedDigest(firstPayload),idempotencyKey:`lease-1-${runId}`,maxAttempts:3}),
    enqueueJob(pool,{tenantId:t1,jobType:"test.lease",payload:secondPayload,payloadDigest:expectedDigest(secondPayload),idempotencyKey:`lease-2-${runId}`,maxAttempts:3}),
  ]);
  assert(first.id===duplicate.id,"enqueue idempotency did not return same job");
  assert(first.id!==second.id,"distinct idempotency keys collided");
  let idempotencyConflict=false;
  try {
    const changed={...firstPayload,taskId:999};
    await enqueueJob(pool,{tenantId:t1,jobType:"test.lease",payload:changed,payloadDigest:expectedDigest(changed),idempotencyKey:`lease-1-${runId}`,maxAttempts:3});
  } catch(error) { idempotencyConflict=error instanceof Error&&error.message==="IDEMPOTENCY_CONFLICT"; }
  assert(idempotencyConflict,"changed payload under same idempotency key was accepted");

  const claimed=await Promise.all([
    claimJob(pool,t1,`worker-A-${runId}`,30,"test.lease"),
    claimJob(pool,t1,`worker-B-${runId}`,30,"test.lease"),
  ]);
  assert(claimed.every(Boolean),"both workers should claim a queued job");
  const claimedIds=claimed.map(j=>j.id);
  assert(new Set(claimedIds).size===2,"two concurrent workers claimed the same job");
  const leaseA=claimed[0],leaseB=claimed[1];
  assert(await heartbeatJob(pool,{tenantId:t1,jobId:leaseA.id,workerId:leaseA.lease_owner??`worker-A-${runId}`,leaseToken:leaseA.lease_token,leaseSeconds:30})===true,"valid worker lease heartbeat failed");

  // Make one lease stale, then prove restart recovery returns it to retryable instead of losing it.
  const stale=leaseB;
  const updateClient=await pool.connect();
  try {
    await updateClient.query("BEGIN");
    await updateClient.query("SELECT set_config('app.tenant_id',$1,true)",[String(t1)]);
    await updateClient.query("UPDATE job_queue SET lease_expires_at=now()-interval '1 second' WHERE id=$1 AND tenant_id=$2",[stale.id,t1]);
    await updateClient.query("COMMIT");
  } catch(error) { await updateClient.query("ROLLBACK"); throw error; }
  finally { updateClient.release(); }
  const recovery=await recoverExpiredJobs(pool,t1);
  assert(recovery.recovered.some(job=>job.id===stale.id&&job.status==="retryable"),"expired lease was not recovered after restart");

  const cancellationPayload={tenantId:t1,taskId:103,actorId:13,requestId:`worker-${runId}-cancel`};
  const cancelJob=await enqueueJob(pool,{tenantId:t1,jobType:"test.cancel",payload:cancellationPayload,payloadDigest:expectedDigest(cancellationPayload),idempotencyKey:`cancel-${runId}`,maxAttempts:2});
  const cancelClaim=await claimJob(pool,t1,`worker-C-${runId}`,30,"test.cancel");
  assert(cancelClaim?.id===cancelJob.id,"cancellation test job was not claimed");
  const request=await requestJobCancellation(pool,t1,cancelClaim.id,103,13);
  assert(request?.status==="cancel_requested","active job cancellation request was not persisted");
  const state=await jobCancellationRequested(pool,{tenantId:t1,jobId:cancelClaim.id,workerId:`worker-C-${runId}`,leaseToken:cancelClaim.lease_token});
  assert(state.leaseValid&&state.cancelRequested,"worker did not observe durable cancellation");
  assert(await heartbeatJob(pool,{tenantId:t1,jobId:cancelClaim.id,workerId:`worker-C-${runId}`,leaseToken:cancelClaim.lease_token})===false,"cancelled job lease was renewed");
  assert(await acknowledgeCancelledJob(pool,{tenantId:t1,jobId:cancelClaim.id,workerId:`worker-C-${runId}`,leaseToken:cancelClaim.lease_token}),"worker could not acknowledge confirmed cancellation");

  const finalStatuses=await pool.query("SELECT id,status FROM job_queue WHERE id=ANY($1::uuid[])",[[leaseA.id,stale.id,cancelClaim.id]]);
  assert(finalStatuses.rows.some(row=>row.id===leaseA.id&&row.status==="leased"),"live job unexpectedly lost its lease");
  assert(finalStatuses.rows.some(row=>row.id===stale.id&&row.status==="retryable"),"recovered job did not return to retryable");
  assert(finalStatuses.rows.some(row=>row.id===cancelClaim.id&&row.status==="cancelled"),"acknowledged cancellation status was not persisted");

  // The original tenant A row remains invisible to tenant B even after worker operations.
  const verify=await pool.connect();
  try {
    await verify.query("BEGIN"); await verify.query("SELECT set_config('app.tenant_id',$1,true)",[String(t2)]);
    const hidden=await verify.query("SELECT id FROM job_queue WHERE id=$1",[crossTenantJobId]);
    assert(hidden.rowCount===0,"cross-tenant visibility changed after worker operations");
    await verify.query("ROLLBACK");
  } finally { verify.release(); }

  console.log(JSON.stringify({
    ok:true,tenantCount:2,rlsTables:5,
    checks:["cross-tenant read/write blocked","missing context sees no rows","idempotent enqueue","payload conflict denied","concurrent SKIP LOCKED claims distinct jobs","lease heartbeat","expired lease restart recovery","durable cancellation request/ack"],
  }));
} finally {
  await pool.end();
}

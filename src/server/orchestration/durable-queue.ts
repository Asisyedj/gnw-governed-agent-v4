import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";

export type ClaimedJob = {
  id: string; tenant_id: number; workflow_id: string | null; job_type: string;
  payload: unknown; payload_digest: string; idempotency_key: string;
  attempts: number; max_attempts: number; lease_token: string; lease_expires_at: Date;
};

async function tenantTx<T>(pool: Pool, tenantId: number, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error("INVALID_TENANT");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [String(tenantId)]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function enqueueJob(pool: Pool, input: {
  tenantId: number; workflowId?: string; jobType: string; payload: unknown;
  payloadDigest: string; idempotencyKey: string; maxAttempts?: number;
}) {
  if (!/^[a-f0-9]{64}$/.test(input.payloadDigest)) throw new Error("INVALID_PAYLOAD_DIGEST");
  if (!input.idempotencyKey.trim()) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  return tenantTx(pool,input.tenantId,async c => {
    const r = await c.query(
      `INSERT INTO job_queue(tenant_id,workflow_id,job_type,payload,payload_digest,idempotency_key,max_attempts)
       VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)
       ON CONFLICT(tenant_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING *`,
      [input.tenantId,input.workflowId ?? null,input.jobType,JSON.stringify(input.payload),input.payloadDigest,input.idempotencyKey,input.maxAttempts ?? 3]);
    const row = r.rows[0];
    if (row.payload_digest !== input.payloadDigest || row.job_type !== input.jobType) throw new Error("IDEMPOTENCY_CONFLICT");
    return row;
  });
}

export async function claimJob(pool: Pool, tenantId: number, workerId: string, leaseSeconds = 30): Promise<ClaimedJob | null> {
  if (!workerId.trim() || !Number.isInteger(leaseSeconds) || leaseSeconds < 5 || leaseSeconds > 300) throw new Error("INVALID_LEASE");
  return tenantTx(pool,tenantId,async c => {
    const token = randomUUID();
    const r = await c.query(
      `WITH candidate AS (
         SELECT id FROM job_queue
         WHERE tenant_id=$1 AND attempts < max_attempts AND run_after <= now()
           AND (status IN ('pending','retryable') OR (status='leased' AND lease_expires_at < now()))
           AND cancel_requested_at IS NULL
         ORDER BY run_after,created_at
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE job_queue j SET status='leased',lease_owner=$2,lease_token=$3::uuid,
         lease_expires_at=now()+($4::text || ' seconds')::interval,
         attempts=j.attempts+1,updated_at=now()
       FROM candidate c WHERE j.id=c.id
       RETURNING j.*`,
      [tenantId,workerId,token,leaseSeconds]);
    return r.rowCount ? r.rows[0] as ClaimedJob : null;
  });
}

export async function heartbeatJob(pool: Pool, input: { tenantId:number; jobId:string; workerId:string; leaseToken:string; leaseSeconds?:number }) {
  return tenantTx(pool,input.tenantId,async c => {
    const r=await c.query(
      `UPDATE job_queue SET lease_expires_at=now()+(($5::text || ' seconds')::interval),updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND lease_owner=$3 AND lease_token=$4::uuid
         AND status='leased' AND lease_expires_at>now() AND cancel_requested_at IS NULL RETURNING id`,
      [input.jobId,input.tenantId,input.workerId,input.leaseToken,input.leaseSeconds ?? 30]);
    return r.rowCount===1;
  });
}

export async function requestJobCancellation(pool: Pool, tenantId:number, jobId:string) {
  return tenantTx(pool,tenantId,async c => {
    const r=await c.query(
      `UPDATE job_queue SET cancel_requested_at=COALESCE(cancel_requested_at,now()),
       status=CASE WHEN status IN ('pending','retryable') THEN 'cancelled' ELSE 'cancel_requested' END,
       updated_at=now() WHERE id=$1 AND tenant_id=$2 AND status IN ('pending','retryable','leased','cancel_requested') RETURNING id,status`,
      [jobId,tenantId]);
    return r.rows[0] ?? null;
  });
}

export async function acknowledgeCancelledJob(pool: Pool, input:{tenantId:number;jobId:string;workerId:string;leaseToken:string}) {
  return tenantTx(pool,input.tenantId,async c => {
    const r=await c.query(
      `UPDATE job_queue SET status='cancelled',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND lease_owner=$3 AND lease_token=$4::uuid
         AND status='cancel_requested' RETURNING id`,
      [input.jobId,input.tenantId,input.workerId,input.leaseToken]);
    return r.rowCount===1;
  });
}

export async function finishJob(pool: Pool, input:{tenantId:number;jobId:string;workerId:string;leaseToken:string;success:boolean;errorCode?:string}) {
  return tenantTx(pool,input.tenantId,async c => {
    const r=await c.query(
      `UPDATE job_queue SET status=CASE WHEN $5 THEN 'succeeded' WHEN attempts < max_attempts THEN 'retryable' ELSE 'failed' END,
       last_error_code=$6,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND lease_owner=$3 AND lease_token=$4::uuid
         AND status='leased' AND lease_expires_at>now() AND cancel_requested_at IS NULL RETURNING status`,
      [input.jobId,input.tenantId,input.workerId,input.leaseToken,input.success,input.errorCode ?? null]);
    if (!r.rowCount) throw new Error("LEASE_LOST_OR_CANCELLED");
    return r.rows[0].status as string;
  });
}

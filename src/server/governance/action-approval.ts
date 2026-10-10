import { createHash, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type ActionBinding = { tenantId:number; taskId?:number; actorId:number; approverId:number; actionType:string; toolId:string; target:string; payload:unknown };
export function canonicalJson(value: unknown): string {
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new Error("NON_JSON_ACTION_PAYLOAD");
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("NON_JSON_ACTION_PAYLOAD");
  if (value === null || typeof value !== "object") return JSON.stringify(value) as string;
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj=value as Record<string,unknown>;
  return "{" + Object.keys(obj).sort().map(k => JSON.stringify(k)+":"+canonicalJson(obj[k])).join(",") + "}";
}
export function actionDigest(binding: Pick<ActionBinding,"actionType"|"toolId"|"target"|"tenantId"|"actorId"|"payload">): string {
  return createHash("sha256").update(canonicalJson({
    actionType:binding.actionType,toolId:binding.toolId,target:binding.target,
    tenantId:binding.tenantId,actorId:binding.actorId,payload:binding.payload
  })).digest("hex");
}
function equalDigest(a:string,b:string) {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
async function tenantTx<T>(pool:Pool,tenantId:number,fn:(c:PoolClient)=>Promise<T>):Promise<T>{
  if (!Number.isSafeInteger(tenantId)||tenantId<=0) throw new Error("INVALID_TENANT");
  const c=await pool.connect();
  try { await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id',$1,true)",[String(tenantId)]); const v=await fn(c); await c.query("COMMIT"); return v; }
  catch(e){ await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
export async function grantActionApproval(pool:Pool,binding:ActionBinding,expiresAt:Date) {
  if(binding.actorId===binding.approverId) throw new Error("SELF_APPROVAL_DENIED");
  if(!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime()<=Date.now()) throw new Error("INVALID_EXPIRY");
  const digest=actionDigest(binding);
  return tenantTx(pool,binding.tenantId,async c=>{
    const r=await c.query(
      `INSERT INTO action_approvals(tenant_id,task_id,actor_id,approver_id,action_type,tool_id,target,payload_digest,nonce,status,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,gen_random_uuid(),'granted',$9) RETURNING id,nonce,payload_digest,expires_at`,
      [binding.tenantId,binding.taskId??null,binding.actorId,binding.approverId,binding.actionType,binding.toolId,binding.target,digest,expiresAt]);
    return r.rows[0];
  });
}
export async function consumeActionApproval(pool:Pool,binding:ActionBinding,approvalId:string,nonce:string) {
  const digest=actionDigest(binding);
  return tenantTx(pool,binding.tenantId,async c=>{
    const r=await c.query(
      `UPDATE action_approvals SET status='consumed',consumed_at=now()
       WHERE id=$1::uuid AND tenant_id=$2 AND task_id IS NOT DISTINCT FROM $3
         AND actor_id=$4 AND approver_id<>actor_id AND action_type=$5 AND tool_id=$6 AND target=$7
         AND payload_digest=$8 AND nonce=$9::uuid AND status='granted' AND expires_at>now()
       RETURNING id`,
      [approvalId,binding.tenantId,binding.taskId??null,binding.actorId,binding.actionType,binding.toolId,binding.target,digest,nonce]);
    if(r.rowCount!==1) throw new Error("APPROVAL_INVALID_EXPIRED_REPLAYED_OR_DIGEST_MISMATCH");
    return {consumed:true,payloadDigest:digest};
  });
}

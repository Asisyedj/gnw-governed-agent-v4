import type { Pool } from "pg";
import { ENV } from "../env.js";
import { db, pgPool } from "../db/index.js";
import { executeGovernedTool, executeWithGovernance } from "../execution.js";
import { digestEnvelope, validateEnvelope } from "../action-envelope.js";
import { digestRequest, type ApprovalRecord, type GovernanceRequest } from "../governance.js";
import { findApprovalById, findTaskById, findUserById, insertAuditLog, updateTaskStatus } from "../repo.js";
import { cancelExecutor } from "../executor-client.js";
import { ExecutionCancellation } from "./cancellation.js";
import { acknowledgeCancelledJob, claimJob, finishJob, heartbeatJob, jobCancellationRequested, recoverExpiredJobs, type ClaimedJob } from "./durable-queue.js";
import { digestQueuePayload, GOVERNED_EXECUTION_JOB, parseQueuedExecutionPayload } from "./queue-payload.js";

const POLL_MS = 1_000;
const LEASE_SECONDS = 30;

function sleep(ms:number,signal:AbortSignal):Promise<void>{
  if(signal.aborted) return Promise.resolve();
  return new Promise(resolve=>{
    const done=()=>{clearTimeout(timer);signal.removeEventListener("abort",done);resolve();};
    const timer=setTimeout(done,ms);
    signal.addEventListener("abort",done,{once:true});
  });
}

function buildApprovalRecord(row:Awaited<ReturnType<typeof findApprovalById>>, reviewerRole?:string):ApprovalRecord|undefined{
  if(!row) return undefined;
  return {
    approvalId:row.id,
    ...(row.requestId===null||row.requestId===undefined?{}:{requestId:row.requestId}),
    actionDigest:row.actionDigest,
    tenant:String(row.tenantId),
    status:row.status as ApprovalRecord["status"],
    ...(row.reviewedByUserId===null||row.reviewedByUserId===undefined?{}:{approverId:row.reviewedByUserId}),
    ...(reviewerRole===undefined?{}:{approverRole:reviewerRole}),
    ...(row.requestedByUserId===null||row.requestedByUserId===undefined?{}:{requestedBy:row.requestedByUserId}),
    expiresAt:row.expiresAt.getTime(),
    nonce:row.nonce,
  };
}

async function auditWorkerEvent(job:ClaimedJob,eventType:string,outcome:"success"|"failure"|"denied",detail:Record<string,unknown>){
  try{
    const payload=parseQueuedExecutionPayload(job.payload);
    await insertAuditLog(db,{
      eventType,actorId:payload.actorId,tenantId:payload.tenantId,taskId:payload.taskId,
      resourceType:"job",resourceId:job.id,outcome,detail,requestId:payload.requestId,
    });
  }catch(error){
    console.error(JSON.stringify({event:"gnw.worker.audit_failure",jobId:job.id,error:error instanceof Error?error.message:String(error)}));
  }
}

async function executeQueuedJob(job:ClaimedJob,cancellation:ExecutionCancellation):Promise<{success:boolean;error?:string;taskId:number;requestId:string}>{
  if(job.job_type!==GOVERNED_EXECUTION_JOB) throw new Error("UNSUPPORTED_JOB_TYPE");
  if(digestQueuePayload(job.payload)!==job.payload_digest) throw new Error("QUEUE_PAYLOAD_DIGEST_MISMATCH");
  const payload=parseQueuedExecutionPayload(job.payload);
  if(payload.tenantId!==job.tenant_id) throw new Error("QUEUE_TENANT_BINDING");
  const {taskId,tenantId,actorId,role,requestId,grant,envelope}=payload;
  if(grant.requestId!==requestId||Number(grant.tenant)!==tenantId||Number(grant.subject)!==actorId||grant.role!==role||grant.taskId!==taskId){
    throw new Error("QUEUE_GOVERNANCE_CONTEXT_MISMATCH");
  }
  const task=await findTaskById(db,taskId,tenantId);
  if(!task||["done","failed","cancelled"].includes(task.status)) throw new Error("QUEUE_TASK_NOT_EXECUTABLE");
  const actor=await findUserById(db,actorId,tenantId);
  if(!actor||!actor.isActive||actor.role!==role) throw new Error("QUEUE_ACTOR_NO_LONGER_AUTHORIZED");
  validateEnvelope(envelope,Date.now(),300_000,{
    taskId,tenantId,actorId,grantId:envelope.grantId,nonce:grant.nonce,operation:grant.operation,tool:grant.tool,
  });
  const envelopeDigest=digestEnvelope(envelope);
  if(envelopeDigest!==grant.envelopeDigest) throw new Error("QUEUE_ENVELOPE_DIGEST_MISMATCH");

  let approval:ApprovalRecord|undefined;
  if(payload.approvalId!==undefined){
    const row=await findApprovalById(db,payload.approvalId,tenantId);
    if(!row) throw new Error("APPROVAL_NOT_FOUND");
    const reviewer=row.reviewedByUserId===null||row.reviewedByUserId===undefined?undefined:await findUserById(db,row.reviewedByUserId,tenantId);
    approval=buildApprovalRecord(row,reviewer?.role);
    if(approval?.actionDigest!==digestRequest(grant)||approval.tenant!==String(tenantId)||approval.requestId!==requestId){
      throw new Error("APPROVAL_DIGEST_BINDING_MISMATCH");
    }
  }

  if(cancellation.signal.aborted) throw new Error("EXECUTION_CANCELLED_BEFORE_GOVERNANCE");
  const ctx={
    db,env:ENV,taskId,tenantId,actorId,role,requestId,governanceRequest:grant as GovernanceRequest,
    grantId:envelope.grantId,cancellation,
    ...(approval===undefined?{}:{approval}),
  };
  const result=await executeWithGovernance(ctx,envelope,async()=>{
    if(cancellation.signal.aborted) throw new Error("EXECUTION_CANCELLED_BEFORE_DISPATCH");
    await updateTaskStatus(db,taskId,tenantId,"running");
    return executeGovernedTool(ctx,envelope.tool,envelope.parameters,digestRequest(grant));
  });
  if(result.success){
    await updateTaskStatus(db,taskId,tenantId,"done");
    await insertAuditLog(db,{eventType:"task.complete",actorId,tenantId,taskId,resourceType:"task",resourceId:String(taskId),outcome:"success",detail:{tool:envelope.tool,requestId,jobId:job.id},requestId});
    return {success:true,taskId,requestId};
  }
  if(result.error==="approval_required"){
    await updateTaskStatus(db,taskId,tenantId,"waiting_approval");
  }else{
    await updateTaskStatus(db,taskId,tenantId,"failed",result.error??"governance_execution_failed");
  }
  await insertAuditLog(db,{eventType:"task.fail",actorId,tenantId,taskId,resourceType:"task",resourceId:String(taskId),outcome:result.error==="approval_required"?"denied":"failure",detail:{error:result.error,jobId:job.id},requestId});
  return {success:false,error:result.error??"GOVERNANCE_EXECUTION_FAILED",taskId,requestId};
}

async function processClaimedJob(pool:Pool,job:ClaimedJob,workerId:string,signal:AbortSignal):Promise<void>{
  let payload:ReturnType<typeof parseQueuedExecutionPayload>|undefined;
  try{
    if(digestQueuePayload(job.payload)!==job.payload_digest) throw new Error("QUEUE_PAYLOAD_DIGEST_MISMATCH");
    payload=parseQueuedExecutionPayload(job.payload);
  }catch(error){
    const code=error instanceof Error?error.message:"QUEUE_PAYLOAD_INVALID";
    await finishJob(pool,{tenantId:job.tenant_id,jobId:job.id,workerId,leaseToken:job.lease_token,success:false,errorCode:code}).catch(()=>undefined);
    await auditWorkerEvent(job,"execution.queue.reject","denied",{reason:code});
    return;
  }

  const cancellation=new ExecutionCancellation();
  const actionDigest=digestRequest(payload.grant);
  // The executor-side /cancel endpoint must install an idempotent requestId fence and
  // confirm process-tree termination. If it cannot prove cancellation, this job is not
  // marked cancelled; restart recovery records CANCEL_UNCONFIRMED instead.
  cancellation.register({
    name:"remote-executor",
    close:(reason)=>cancelExecutor(ENV,{requestId:payload!.requestId,actionDigest,reason}),
  });

  let cancellationReason:"requested"|"shutdown"|"lease_lost"|null=null;
  let cancellationError:unknown;
  let cancellationPromise:Promise<void>|null=null;
  let pollBusy=false;
  const initiateCancellation=(reason:string,kind:"requested"|"shutdown"|"lease_lost")=>{
    cancellationReason??=kind;
    cancellationPromise??=cancellation.cancel(reason).catch(error=>{cancellationError=error;throw error;});
    void cancellationPromise.catch(()=>undefined);
    return cancellationPromise;
  };

  const poller=setInterval(async()=>{
    if(pollBusy||cancellationReason!==null) return;
    pollBusy=true;
    try{
      const state=await jobCancellationRequested(pool,{tenantId:job.tenant_id,jobId:job.id,workerId,leaseToken:job.lease_token});
      if(!state.leaseValid){
        await initiateCancellation("worker lease lost","lease_lost");
        return;
      }
      if(state.cancelRequested){
        await initiateCancellation("durable cancellation requested","requested");
        return;
      }
      const renewed=await heartbeatJob(pool,{tenantId:job.tenant_id,jobId:job.id,workerId,leaseToken:job.lease_token,leaseSeconds:LEASE_SECONDS});
      if(!renewed) await initiateCancellation("worker lease renewal failed","lease_lost");
    }catch(error){
      await initiateCancellation("worker heartbeat or cancellation state unavailable","lease_lost").catch(()=>undefined);
      console.error(JSON.stringify({event:"gnw.worker.heartbeat_failure",jobId:job.id,error:error instanceof Error?error.message:String(error)}));
    }finally{pollBusy=false;}
  },POLL_MS);

  const onShutdown=()=>{void initiateCancellation("worker shutdown","shutdown").catch(()=>undefined);};
  signal.addEventListener("abort",onShutdown,{once:true});
  try{
    const firstState=await jobCancellationRequested(pool,{tenantId:job.tenant_id,jobId:job.id,workerId,leaseToken:job.lease_token});
    if(!firstState.leaseValid) return;
    if(firstState.cancelRequested) await initiateCancellation("durable cancellation requested","requested").catch(()=>undefined);
    let outcome:{success:boolean;error?:string;taskId:number;requestId:string}|undefined;
    if(cancellationReason===null) outcome=await executeQueuedJob(job,cancellation);
    if(cancellationReason!==null){
      await cancellationPromise?.catch(()=>undefined);
      if(cancellationReason==="lease_lost") return;
      if(cancellationReason==="requested"&&!cancellationError){
        const acknowledged=await acknowledgeCancelledJob(pool,{tenantId:job.tenant_id,jobId:job.id,workerId,leaseToken:job.lease_token});
        if(acknowledged){
          await updateTaskStatus(db,payload.taskId,payload.tenantId,"cancelled","cancelled_by_request").catch(()=>undefined);
          await auditWorkerEvent(job,"execution.cancel_confirmed","success",{reason:"executor confirmed cancellation"});
          return;
        }
      }
      const errorCode=cancellationError?"CANCEL_UNCONFIRMED":"WORKER_SHUTDOWN";
      await finishJob(pool,{tenantId:job.tenant_id,jobId:job.id,workerId,leaseToken:job.lease_token,success:false,errorCode}).catch(()=>undefined);
      await updateTaskStatus(db,payload.taskId,payload.tenantId,"failed",errorCode.toLowerCase()).catch(()=>undefined);
      await auditWorkerEvent(job,"execution.cancel_unconfirmed","failure",{errorCode});
      return;
    }
    if(!outcome) throw new Error("WORKER_OUTCOME_MISSING");
    await finishJob(pool,{
      tenantId:job.tenant_id,jobId:job.id,workerId,leaseToken:job.lease_token,
      success:outcome.success,errorCode:outcome.error,
    });
    await auditWorkerEvent(job,outcome.success?"execution.queue.complete":"execution.queue.failed",outcome.success?"success":(outcome.error==="approval_required"?"denied":"failure"),{
      error:outcome.error??null,attempt:job.attempts,
    });
  }catch(error){
    const code=error instanceof Error?error.message:"WORKER_EXECUTION_FAILED";
    await finishJob(pool,{tenantId:job.tenant_id,jobId:job.id,workerId,leaseToken:job.lease_token,success:false,errorCode:code}).catch(()=>undefined);
    if(payload) await updateTaskStatus(db,payload.taskId,payload.tenantId,"failed",code).catch(()=>undefined);
    await auditWorkerEvent(job,"execution.queue.failed","failure",{error:code});
  }finally{
    clearInterval(poller);
    signal.removeEventListener("abort",onShutdown);
  }
}

/** One tenant-scoped worker loop. Each worker process must run under a non-owner, non-BYPASSRLS DB role. */
export async function runTenantWorker(input:{pool?:Pool;tenantId:number;workerId:string;signal:AbortSignal}):Promise<void>{
  const pool=input.pool??pgPool;
  const {tenantId,workerId,signal}=input;
  if(!Number.isSafeInteger(tenantId)||tenantId<=0||!workerId.trim()) throw new Error("INVALID_WORKER_IDENTITY");
  const recovered=await recoverExpiredJobs(pool,tenantId);
  console.log(JSON.stringify({event:"gnw.worker.recovery",tenantId,workerId,recovered:recovered.recovered.length,cancellationUnconfirmed:recovered.cancellationUnconfirmed.length}));
  while(!signal.aborted){
    try{
      const job=await claimJob(pool,tenantId,workerId,LEASE_SECONDS,GOVERNED_EXECUTION_JOB);
      if(!job){await sleep(POLL_MS,signal);continue;}
      await processClaimedJob(pool,job,workerId,signal);
    }catch(error){
      console.error(JSON.stringify({event:"gnw.worker.loop_error",tenantId,workerId,error:error instanceof Error?error.message:String(error)}));
      await sleep(POLL_MS,signal);
    }
  }
}

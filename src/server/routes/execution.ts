import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { SPECIALIST_AGENTS, CLASSIFICATIONS, type Classification } from "../../shared/types.js";
import { ENV } from "../env.js";
import { digestEnvelope, validateEnvelope, type ActionEnvelope } from "../action-envelope.js";
import { executeGovernedTool, executeWithGovernance } from "../execution.js";
import { digestRequest, requiresHumanApproval, type ApprovalRecord, type GovernanceRequest } from "../governance.js";
import { verifyGrantSignature } from "../security.js";
import {
  createApproval,
  findApprovalById,
  findTaskById,
  findUserById,
  insertAuditLog,
  updateTaskStatus,
} from "../repo.js";
import { resolveSession } from "./auth.js";
import type { Db } from "../db/index.js";
import { pgPool } from "../db/index.js";
import { enqueueJob, requestJobCancellation } from "../orchestration/durable-queue.js";
import { digestQueuePayload, GOVERNED_EXECUTION_JOB } from "../orchestration/queue-payload.js";

declare module "fastify" { interface FastifyInstance { db: Db; } }

const envelopeSchema=z.object({
  taskId:z.string().min(1).max(32),
  tenantId:z.string().min(1).max(32),
  actorId:z.string().min(1).max(32),
  operation:z.string().min(1).max(200),
  tool:z.string().min(1).max(200),
  parameters:z.unknown(),
  grantId:z.string().min(1).max(200),
  nonce:z.string().min(1).max(200),
  issuedAt:z.number().int(),
}).strict();

const grantSchema=z.object({
  requestId:z.string().min(1).max(200),
  subject:z.string().regex(/^\d+$/),
  tenant:z.string().regex(/^\d+$/),
  role:z.string().min(1).max(50),
  purpose:z.string().min(1).max(200),
  classification:z.enum(CLASSIFICATIONS),
  operation:z.string().min(1).max(200),
  resource:z.string().min(1).max(500),
  agent:z.enum(SPECIALIST_AGENTS),
  tool:z.string().min(1).max(200),
  scope:z.string().min(1).max(200),
  budgetTokens:z.number().int().positive().max(100000),
  budgetBytes:z.number().int().positive().max(50000000),
  issuedAt:z.number().int(),
  expiresAt:z.number().int(),
  nonce:z.string().min(1).max(200),
  taskId:z.number().int().positive(),
  normalizedParameters:z.record(z.unknown()).optional(),
  inputDigest:z.string().regex(/^[0-9a-f]{64}$/).optional(),
  envelopeDigest:z.string().regex(/^[0-9a-f]{64}$/),
  providerParameters:z.record(z.unknown()).optional(),
  provenance:z.record(z.object({value:z.unknown(),source:z.string(),trust:z.string()})).optional(),
  capability:z.string().min(1).max(200).optional(),
  outputConstraints:z.record(z.unknown()).optional(),
  budgetReservationTokens:z.number().int().positive().optional(),
  budgetReservationBytes:z.number().int().positive().optional(),
  issuer:z.string().min(1).max(200).optional(),
  signature:z.string().min(1).max(1000).optional(),
  runtimeAttestation:z.object({
    issuer:z.string().min(1).max(200),
    measurement:z.string().regex(/^[0-9a-fA-F]{64}$/),
    nonce:z.string().regex(/^[0-9a-fA-F]{32,128}$/),
    issuedAt:z.number().int(),
    expiresAt:z.number().int(),
    signature:z.string().regex(/^[0-9a-fA-F]+$/),
    actionDigest:z.string().regex(/^[0-9a-fA-F]{64}$/),
  }).optional(),
  mpcAttestation:z.object({
    measurement:z.string().regex(/^[0-9a-fA-F]{64}$/),
    signatures:z.array(z.object({
      participantId:z.string().min(1).max(200),
      signature:z.string().regex(/^[0-9a-fA-F]+$/),
    })).max(64),
  }).optional(),
}).passthrough();

const executionSchema=z.object({
  grant:grantSchema,
  envelope:envelopeSchema,
  approvalId:z.number().int().positive().optional(),
}).strict();

function legacyTaskClassification(value:string): Classification {
  if(value==="standard") return "internal";
  if((CLASSIFICATIONS as readonly string[]).includes(value)) return value as Classification;
  throw new Error("task_classification_invalid");
}

function buildApprovalRecord(row:Awaited<ReturnType<typeof findApprovalById>>, reviewerRole?:string):ApprovalRecord|undefined {
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

async function authenticate(app:{db:Db},req:FastifyRequest){
  const session=await resolveSession(app.db,req.cookies as Record<string,string>);
  if(!session) return {error:{status:401,body:{error:"Unauthenticated",code:"unauthenticated"}} as const};
  const user=await findUserById(app.db,session.userId,session.tenantId);
  if(!user) return {error:{status:401,body:{error:"Unauthenticated",code:"unauthenticated"}} as const};
  if(!["owner","admin","operator"].includes(user.role)) return {error:{status:403,body:{error:"Insufficient role for governed execution.",code:"forbidden"}} as const};
  return {session,user};
}

function validateSignedGrant(grant:GovernanceRequest){
  if(!ENV.requireSignedGrants) return true;
  return Boolean(grant.issuer&&grant.signature&&verifyGrantSignature(grant as unknown as Record<string,unknown>,grant.issuer,grant.signature,ENV.grantPublicKeyPem));
}

export const executionRoutes:FastifyPluginAsync=async(app)=>{
  app.post("/:id/execute/queued",async(req,reply)=>{
    const auth=await authenticate(app,req);
    if("error" in auth) return reply.status(auth.error.status).send(auth.error.body);
    const taskId=Number((req.params as {id:string}).id);
    if(!Number.isSafeInteger(taskId)||taskId<=0) return reply.status(400).send({error:"Invalid task ID",code:"invalid_task_id"});
    const task=await findTaskById(app.db,taskId,auth.session.tenantId);
    if(!task) return reply.status(404).send({error:"Task not found",code:"not_found"});
    if(["done","failed","cancelled"].includes(task.status)) return reply.status(409).send({error:"Task is already terminal.",code:"task_terminal"});

    const parsed=executionSchema.safeParse(req.body);
    if(!parsed.success) return reply.status(400).send({error:"Invalid execution request",details:parsed.error.issues});
    const envelope=parsed.data.envelope as ActionEnvelope;
    const grant=parsed.data.grant as GovernanceRequest;

    try{
      if(grant.taskId!==taskId) throw new Error("task_binding");
      if(Number(grant.tenant)!==auth.session.tenantId||Number(grant.subject)!==auth.session.userId||grant.role!==auth.user.role) throw new Error("identity_binding");
      if(legacyTaskClassification(task.classification)!==grant.classification) throw new Error("classification_binding");
      if(grant.budgetTokens>task.budgetTokensAllocated-task.budgetTokensUsed||grant.budgetBytes>task.budgetBytesAllocated-task.budgetBytesUsed) throw new Error("task_budget_exceeded");
      validateEnvelope(envelope,Date.now(),300_000,{taskId,tenantId:auth.session.tenantId,actorId:auth.session.userId,grantId:envelope.grantId,nonce:grant.nonce,operation:grant.operation,tool:grant.tool});
      const envelopeDigest=digestEnvelope(envelope);
      if(envelopeDigest!==grant.envelopeDigest) throw new Error("governance_digest_mismatch");
      if(!validateSignedGrant(grant)) throw new Error("invalid_grant_signature");

      const actionDigest=digestRequest(grant);
      if(requiresHumanApproval(grant)){
        if(parsed.data.approvalId===undefined){
          return reply.status(428).send({ok:false,code:"approval_required",actionDigest,message:"An approved, exact-digest approval record is required before queueing this action."});
        }
        const row=await findApprovalById(app.db,parsed.data.approvalId,auth.session.tenantId);
        if(!row) return reply.status(404).send({error:"Approval not found",code:"approval_not_found"});
        if(row.status==="denied") return reply.status(409).send({error:"Approval denied.",code:"approval_denied"});
        if(row.status!=="approved") return reply.status(428).send({ok:false,code:"approval_required",actionDigest});
        if(row.expiresAt.getTime()<=Date.now()) return reply.status(410).send({error:"Approval expired.",code:"approval_expired"});
        if(row.actionDigest!==actionDigest||row.requestId!==grant.requestId||row.tenantId!==auth.session.tenantId) {
          throw new Error("approval_binding");
        }
      }

      const payload={
        version:1 as const,taskId,tenantId:auth.session.tenantId,actorId:auth.session.userId,
        role:auth.user.role,requestId:grant.requestId,grant,envelope,
        ...(parsed.data.approvalId===undefined?{}:{approvalId:parsed.data.approvalId}),
      };
      const job=await enqueueJob(pgPool,{
        tenantId:auth.session.tenantId,jobType:GOVERNED_EXECUTION_JOB,
        payload,payloadDigest:digestQueuePayload(payload),
        idempotencyKey:`execution:${grant.requestId}`,maxAttempts:3,
      });
      await insertAuditLog(app.db,{eventType:"execution.queue.enqueue",actorId:auth.session.userId,tenantId:auth.session.tenantId,taskId,resourceType:"job",resourceId:String(job.id),outcome:"success",detail:{jobType:GOVERNED_EXECUTION_JOB,payloadDigest:job.payload_digest,actionDigest},requestId:grant.requestId,ipAddress:req.ip});
      return reply.status(202).send({ok:true,queued:true,taskId,jobId:job.id,status:job.status,payloadDigest:job.payload_digest,actionDigest});
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      await insertAuditLog(app.db,{eventType:"governance.deny",actorId:auth.session.userId,tenantId:auth.session.tenantId,taskId,resourceType:"task",resourceId:String(taskId),outcome:"denied",detail:{reason:message,stage:"queue_enqueue"},requestId:grant.requestId,ipAddress:req.ip}).catch(()=>undefined);
      return reply.status(message==="grant_expired"?410:400).send({error:"Queued execution request refused.",code:message});
    }
  });

  app.post("/:id/execute/jobs/:jobId/cancel",async(req,reply)=>{
    const auth=await authenticate(app,req);
    if("error" in auth) return reply.status(auth.error.status).send(auth.error.body);
    const taskId=Number((req.params as {id:string}).id);
    const jobId=(req.params as {jobId:string}).jobId;
    if(!Number.isSafeInteger(taskId)||taskId<=0) return reply.status(400).send({error:"Invalid task ID",code:"invalid_task_id"});
    if(!z.string().uuid().safeParse(jobId).success) return reply.status(400).send({error:"Invalid job ID",code:"invalid_job_id"});
    const task=await findTaskById(app.db,taskId,auth.session.tenantId);
    if(!task) return reply.status(404).send({error:"Task not found",code:"not_found"});
    const elevated=auth.user.role==="owner"||auth.user.role==="admin";
    const result=await requestJobCancellation(pgPool,auth.session.tenantId,jobId,taskId,elevated?undefined:auth.session.userId);
    if(!result) return reply.status(404).send({error:"Queued execution job not found.",code:"job_not_found"});
    if(result.status==="cancelled") await updateTaskStatus(app.db,taskId,auth.session.tenantId,"cancelled","cancelled_before_worker_claim");
    await insertAuditLog(app.db,{eventType:"execution.cancel_request",actorId:auth.session.userId,tenantId:auth.session.tenantId,taskId,resourceType:"job",resourceId:jobId,outcome:"success",detail:{status:result.status},requestId:req.id,ipAddress:req.ip});
    return reply.send({ok:true,jobId,status:result.status,cancellationConfirmed:result.status==="cancelled"});
  });
  app.post("/:id/execute/approval",async(req,reply)=>{
    const auth=await authenticate(app,req);
    if("error" in auth) return reply.status(auth.error.status).send(auth.error.body);
    const taskId=Number((req.params as {id:string}).id);
    if(!Number.isSafeInteger(taskId)||taskId<=0) return reply.status(400).send({error:"Invalid task ID",code:"invalid_task_id"});
    const task=await findTaskById(app.db,taskId,auth.session.tenantId);
    if(!task) return reply.status(404).send({error:"Task not found",code:"not_found"});

    const parsed=executionSchema.safeParse(req.body);
    if(!parsed.success) return reply.status(400).send({error:"Invalid execution request",details:parsed.error.issues});
    const envelope=parsed.data.envelope as ActionEnvelope;
    const grant=parsed.data.grant as GovernanceRequest;

    try{
      if(grant.taskId!==taskId) throw new Error("task_binding");
      if(Number(grant.tenant)!==auth.session.tenantId||Number(grant.subject)!==auth.session.userId||grant.role!==auth.user.role) throw new Error("identity_binding");
      if(legacyTaskClassification(task.classification)!==grant.classification) throw new Error("classification_binding");
      if(grant.budgetTokens>task.budgetTokensAllocated-task.budgetTokensUsed||grant.budgetBytes>task.budgetBytesAllocated-task.budgetBytesUsed) throw new Error("task_budget_exceeded");
      validateEnvelope(envelope,Date.now(),300_000,{taskId,tenantId:auth.session.tenantId,actorId:auth.session.userId,grantId:envelope.grantId,nonce:grant.nonce,operation:grant.operation,tool:grant.tool});
      if(digestEnvelope(envelope)!==grant.envelopeDigest) throw new Error("governance_digest_mismatch");
      if(!requiresHumanApproval(grant)) return reply.status(400).send({error:"Human approval is not required for this action.",code:"approval_not_required"});
      if(!validateSignedGrant(grant)) throw new Error("invalid_grant_signature");

      const actionDigest=digestRequest(grant);
      const expiresAt=new Date(Math.min(grant.expiresAt,Date.now()+600_000));
      if(expiresAt.getTime()<=Date.now()) throw new Error("grant_expired");
      const approval=await createApproval(app.db,{tenantId:auth.session.tenantId,taskId,requestedByUserId:auth.session.userId,actionDigest,requestId:grant.requestId,expiresAt});
      await insertAuditLog(app.db,{eventType:"approval.create",actorId:auth.session.userId,tenantId:auth.session.tenantId,taskId,resourceType:"approval",resourceId:String(approval.id),outcome:"success",detail:{actionDigest,requestId:grant.requestId},requestId:grant.requestId,ipAddress:req.ip});
      return reply.status(201).send({approvalId:approval.id,status:approval.status,actionDigest,expiresAt:approval.expiresAt});
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      await insertAuditLog(app.db,{eventType:"governance.deny",actorId:auth.session.userId,tenantId:auth.session.tenantId,taskId,resourceType:"task",resourceId:String(taskId),outcome:"denied",detail:{reason:message},requestId:grant.requestId,ipAddress:req.ip}).catch(()=>undefined);
      return reply.status(message==="grant_expired"?410:400).send({error:"Execution approval request refused.",code:message});
    }
  });

  app.post("/:id/execute",async(req,reply)=>{
    const auth=await authenticate(app,req);
    if("error" in auth) return reply.status(auth.error.status).send(auth.error.body);
    const taskId=Number((req.params as {id:string}).id);
    if(!Number.isSafeInteger(taskId)||taskId<=0) return reply.status(400).send({error:"Invalid task ID",code:"invalid_task_id"});
    const task=await findTaskById(app.db,taskId,auth.session.tenantId);
    if(!task) return reply.status(404).send({error:"Task not found",code:"not_found"});
    if(["done","failed","cancelled"].includes(task.status)) return reply.status(409).send({error:"Task is already terminal.",code:"task_terminal"});

    const parsed=executionSchema.safeParse(req.body);
    if(!parsed.success) return reply.status(400).send({error:"Invalid execution request",details:parsed.error.issues});
    const envelope=parsed.data.envelope as ActionEnvelope;
    const grant=parsed.data.grant as GovernanceRequest;

    if(grant.taskId!==taskId||Number(grant.tenant)!==auth.session.tenantId||Number(grant.subject)!==auth.session.userId||grant.role!==auth.user.role){
      return reply.status(403).send({error:"Execution context does not match the authenticated task.",code:"execution_context_binding"});
    }

    try{
      if(legacyTaskClassification(task.classification)!==grant.classification) throw new Error("classification_binding");
      if(grant.budgetTokens>task.budgetTokensAllocated-task.budgetTokensUsed||grant.budgetBytes>task.budgetBytesAllocated-task.budgetBytesUsed) throw new Error("task_budget_exceeded");

      let approval:ApprovalRecord|undefined;
      if(parsed.data.approvalId!==undefined){
        const row=await findApprovalById(app.db,parsed.data.approvalId,auth.session.tenantId);
        if(!row) return reply.status(404).send({error:"Approval not found",code:"approval_not_found"});
        const reviewer=row.reviewedByUserId===null||row.reviewedByUserId===undefined?undefined:await findUserById(app.db,row.reviewedByUserId,auth.session.tenantId);
        approval=buildApprovalRecord(row,reviewer?.role);
        if(approval?.status==="denied") return reply.status(409).send({error:"Approval denied.",code:"approval_denied"});
        if(approval?.status==="expired" || (approval?.expiresAt!==undefined && approval.expiresAt<=Date.now())) return reply.status(410).send({error:"Approval expired.",code:"approval_expired"});
      }

      const ctx={
        db:app.db,env:ENV,taskId,tenantId:auth.session.tenantId,actorId:auth.session.userId,role:auth.user.role,requestId:grant.requestId,
        governanceRequest:grant,grantId:envelope.grantId,
        ...(approval===undefined?{}:{approval}),
      };
      const result=await executeWithGovernance(ctx,envelope,async()=> {
        await updateTaskStatus(app.db,taskId,auth.session.tenantId,"running");
        return executeGovernedTool(ctx,envelope.tool,envelope.parameters,digestRequest(grant));
      });

      if(result.success){
        await updateTaskStatus(app.db,taskId,auth.session.tenantId,"done");
        await insertAuditLog(app.db,{eventType:"task.complete",actorId:auth.session.userId,tenantId:auth.session.tenantId,taskId,resourceType:"task",resourceId:String(taskId),outcome:"success",detail:{tool:envelope.tool,requestId:grant.requestId},requestId:grant.requestId,ipAddress:req.ip});
        return reply.send({ok:true,taskId,result});
      }

      if(result.error==="approval_required"){
        await updateTaskStatus(app.db,taskId,auth.session.tenantId,"waiting_approval");
        return reply.status(428).send({ok:false,taskId,code:"approval_required",actionDigest:digestRequest(grant),message:"Human approval is required before execution."});
      }

      await updateTaskStatus(app.db,taskId,auth.session.tenantId,"failed",result.error);
      return reply.status(result.error==="safety_interlock"?503:409).send({ok:false,taskId,error:result.error,durationMs:result.durationMs});
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      await updateTaskStatus(app.db,taskId,auth.session.tenantId,"failed",message).catch(()=>undefined);
      await insertAuditLog(app.db,{eventType:"task.fail",actorId:auth.session.userId,tenantId:auth.session.tenantId,taskId,resourceType:"task",resourceId:String(taskId),outcome:"failure",detail:{error:message},requestId:grant.requestId,ipAddress:req.ip}).catch(()=>undefined);
      return reply.status(400).send({ok:false,taskId,error:message});
    }
  });
};

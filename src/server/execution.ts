import type { Db } from "./db/index.js";
import type { Env } from "./env.js";
import { audit } from "./audit.js";
import { governedFetch, assertEgressUrl } from "./security.js";
import { appendTaskLedgerEvent, claimNonce, consumeCapabilityLease, createCapabilityLease, getInterlock, reserveBudget } from "./repo.js";
import { GovernanceService, type ApprovalRecord, type GovernanceRequest } from "./governance.js";
import { verifyCapabilityLeaseSignature, type CapabilityLease } from "./capability.js";
import { validateEnvelope, digestEnvelope, type ActionEnvelope } from "./action-envelope.js";
import { randomUUID } from "node:crypto";
import { ImmutableLedger } from "../core/ledger/ImmutableLedger.js";
import { callExecutor } from "./executor-client.js";

export type ExecutionContext={
  db:Db; env:Env; taskId:number; tenantId:number; actorId:number; role:string; requestId:string;
  governanceRequest:GovernanceRequest; approval?:ApprovalRecord; grantId:string;
  ledger?:ImmutableLedger; missionId?:string; ledgerParentEventId?:string;
};
export type ExecutionResult={success:boolean;output?:unknown;error?:string;durationMs:number};

export async function executeWithGovernance(
  ctx:ExecutionContext,
  envelope:ActionEnvelope,
  handler:(lease?:CapabilityLease)=>Promise<unknown>
):Promise<ExecutionResult>{
  const start=Date.now();
  const appendLedgerEvent=async (eventType:"EXECUTION_REQUESTED"|"EXECUTION_ADMITTED"|"EXECUTION_DENIED"|"EXECUTION_COMPLETED"|"EXECUTION_FAILED", payload:unknown):Promise<void> => {
    if(ctx.ledger){
      const prior=ctx.ledgerParentEventId;
      if(!ctx.missionId || (eventType!=="EXECUTION_REQUESTED" && !prior)) throw new Error("ledger_execution_context_missing");
      const event=ctx.ledger.append({ eventId:`${ctx.requestId}:${eventType}:${randomUUID()}`, taskId:String(ctx.taskId), missionId:ctx.missionId, eventType, ...(prior?{causalParentId:prior}:{}), payload:typeof payload === "object" && payload !== null ? JSON.parse(JSON.stringify(payload)) : String(payload) });
      ctx.ledgerParentEventId=event.eventId;
      return;
    }
    if(!ctx.missionId) return;
    const prior=ctx.ledgerParentEventId;
    if(eventType!=="EXECUTION_REQUESTED" && !prior) throw new Error("ledger_execution_parent_missing");
    const event=await appendTaskLedgerEvent(ctx.db,ctx.tenantId,ctx.taskId,ctx.missionId,{ eventId:`${ctx.requestId}:${eventType}:${randomUUID()}`, taskId:String(ctx.taskId), missionId:ctx.missionId, eventType, ...(prior?{causalParentId:prior}:{}), payload:typeof payload === "object" && payload !== null ? JSON.parse(JSON.stringify(payload)) : String(payload) });
    ctx.ledgerParentEventId=event.eventId;
  };
  const leaseTtlMs=Math.min(300_000, Math.max(1, ctx.governanceRequest.expiresAt-Date.now()));
  const attestationVerifier=ctx.env.teeAttestationIssuer&&ctx.env.teeAttestationPublicKeyPem
    ? {
        issuer:ctx.env.teeAttestationIssuer,
        publicKeyPem:ctx.env.teeAttestationPublicKeyPem,
        ...(ctx.env.teeAttestationMeasurement?{expectedMeasurement:ctx.env.teeAttestationMeasurement}:{}),
        maxAgeMs:ctx.env.teeAttestationMaxAgeMs,
      }
    : undefined;
  const governance=new GovernanceService(
    {
      claimNonce:(k,n,t)=>claimNonce(ctx.db,k,n,t),
      reserveBudget:(tenantId,taskId,nonce,tokens,bytes)=>reserveBudget(ctx.db,tenantId,taskId,nonce,tokens,bytes),
      getInterlock:()=>getInterlock(ctx.db),
      persistCapabilityLease: lease => createCapabilityLease(ctx.db,{
        leaseId:lease.leaseId,
        taskId:lease.taskId,
        tenantId:Number(lease.tenant),
        actorUserId:lease.actorUserId,
        requestId:lease.requestId,
        actionDigest:lease.actionDigest,
        subject:lease.subject,
        capability:lease.capability,
        destination:lease.destination,
        interlockGeneration:lease.interlockGeneration,
        issuer:lease.issuer,
        signature:lease.signature,
        issuedAt:new Date(lease.issuedAt),
        expiresAt:new Date(lease.expiresAt),
      }),
    },
    undefined,
    Date.now,
    ctx.env.requireSignedGrants
      ? {issuer:ctx.env.grantIssuer,publicKeyPem:ctx.env.grantPublicKeyPem}
      : undefined,
    ctx.env.leasePrivateKeyPem
      ? {issuer:ctx.env.grantIssuer,privateKeyPem:ctx.env.leasePrivateKeyPem,ttlMs:leaseTtlMs}
      : undefined,
    attestationVerifier,
    ctx.env.teeAttestationRequired,
    ctx.env.mpcTrustAnchor,
    ctx.env.requireMpcTrustAnchor,
  );

  try{
    if(ctx.governanceRequest.requestId!==ctx.requestId || Number(ctx.governanceRequest.subject)!==ctx.actorId || Number(ctx.governanceRequest.tenant)!==ctx.tenantId || ctx.governanceRequest.taskId!==ctx.taskId || ctx.governanceRequest.role!==ctx.role){
      throw new Error("governance_context_mismatch");
    }
    validateEnvelope(
      envelope,
      Date.now(),
      300_000,
      {
        taskId:ctx.taskId,
        tenantId:ctx.tenantId,
        actorId:ctx.actorId,
        grantId:ctx.grantId,
        nonce:ctx.governanceRequest.nonce,
        operation:ctx.governanceRequest.operation,
        tool:ctx.governanceRequest.tool
      }
    );

    const envelopeDigest=digestEnvelope(envelope);
    if(ctx.governanceRequest.envelopeDigest!==envelopeDigest){
      throw new Error("ActionEnvelope: governance_digest_mismatch");
    }

    await appendLedgerEvent("EXECUTION_REQUESTED",{requestId:ctx.requestId,actionDigest:envelopeDigest,tool:envelope.tool});
    const d=await governance.authorize(ctx.governanceRequest,ctx.approval);
    if(!d.allowed){
      await appendLedgerEvent("EXECUTION_DENIED",{reason:d.reason,actionDigest:d.actionDigest});
      await audit(ctx.db,{eventType:"governance.deny",actorId:ctx.actorId,tenantId:ctx.tenantId,taskId:ctx.taskId,resourceType:"tool",resourceId:envelope.tool,outcome:"denied",detail:{reason:d.reason,actionDigest:d.actionDigest},requestId:ctx.requestId},{required:true});
      return{success:false,error:d.reason,durationMs:Date.now()-start};
    }
    await appendLedgerEvent("EXECUTION_ADMITTED",{actionDigest:d.actionDigest,tool:envelope.tool});
    const digest=digestEnvelope(envelope);
    await audit(ctx.db,{eventType:"tool.invoke",actorId:ctx.actorId,tenantId:ctx.tenantId,taskId:ctx.taskId,resourceType:"tool",resourceId:envelope.tool,outcome:"success",detail:{digest,actionDigest:d.actionDigest,operation:envelope.operation,capabilityLeaseId:d.capabilityLease?.leaseId},requestId:ctx.requestId},{required:true});
    if(d.capabilityLease){
      if(!ctx.env.leasePublicKeyPem || d.capabilityLease.issuer!==ctx.env.grantIssuer || !verifyCapabilityLeaseSignature(d.capabilityLease,ctx.env.leasePublicKeyPem)){
        throw new Error("capability_lease_signature_invalid");
      }
      await audit(ctx.db,{eventType:"capability.signature_verified",actorId:ctx.actorId,tenantId:ctx.tenantId,taskId:ctx.taskId,resourceType:"capability_lease",resourceId:d.capabilityLease.leaseId,outcome:"success",detail:{actionDigest:d.actionDigest,issuer:d.capabilityLease.issuer},requestId:ctx.requestId},{required:true});
      const consumed=await consumeCapabilityLease(ctx.db,{leaseId:d.capabilityLease.leaseId,tenantId:ctx.tenantId,taskId:ctx.taskId,actorUserId:ctx.actorId,actionDigest:d.actionDigest,interlockGeneration:d.capabilityLease.interlockGeneration,signature:d.capabilityLease.signature,publicKeyPem:ctx.env.leasePublicKeyPem});
      if(!consumed) throw new Error("capability_lease_invalid_or_replayed");
      await audit(ctx.db,{eventType:"capability.consume",actorId:ctx.actorId,tenantId:ctx.tenantId,taskId:ctx.taskId,resourceType:"capability_lease",resourceId:d.capabilityLease.leaseId,outcome:"success",detail:{actionDigest:d.actionDigest,interlockGeneration:d.capabilityLease.interlockGeneration},requestId:ctx.requestId},{required:true});
    }
    const output=await handler(d.capabilityLease);
    await appendLedgerEvent("EXECUTION_COMPLETED",{actionDigest:d.actionDigest,tool:envelope.tool});
    await audit(ctx.db,{eventType:"tool.result",actorId:ctx.actorId,tenantId:ctx.tenantId,taskId:ctx.taskId,resourceType:"tool",resourceId:envelope.tool,outcome:"success",detail:{digest,actionDigest:d.actionDigest,capabilityLeaseId:d.capabilityLease?.leaseId},requestId:ctx.requestId},{required:true});
    return{success:true,output,durationMs:Date.now()-start};
  }catch(e){
    const m=e instanceof Error?e.message:String(e);
    try{await appendLedgerEvent("EXECUTION_FAILED",{error:m.slice(0,200),tool:envelope.tool});}catch{/* preserve the original fail-closed error */}
    try{await audit(ctx.db,{eventType:"tool.deny",actorId:ctx.actorId,tenantId:ctx.tenantId,taskId:ctx.taskId,resourceType:"tool",resourceId:envelope.tool,outcome:"failure",detail:{error:m},requestId:ctx.requestId},{required:true});}catch{/* required audit failure already triggers the safety interlock */}
    return{success:false,error:m,durationMs:Date.now()-start};
  }
}

export async function executeGovernedTool(
  ctx: ExecutionContext,
  tool: string,
  parameters: unknown,
  actionDigest: string,
): Promise<unknown> {
  if (tool !== "executor.command") throw new Error("tool_not_allowlisted");
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) throw new Error("executor_parameters_invalid");
  const p = parameters as Record<string, unknown>;
  const command = p.command;
  if (!Array.isArray(command) || command.length < 1 || command.length > 64 || command.some(x => typeof x !== "string" || x.length === 0 || x.length > 4096)) {
    throw new Error("executor_command_invalid");
  }
  const cwd = p.cwd;
  if (cwd !== undefined && (typeof cwd !== "string" || cwd.length > 4096)) throw new Error("executor_cwd_invalid");
  const timeoutMs = p.timeoutMs;
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000)) {
    throw new Error("executor_timeout_invalid");
  }
  const result = await callExecutor(ctx.env, command as string[], {
    ...(cwd === undefined ? {} : { cwd }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    requestId: ctx.requestId,
    actionDigest,
  });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

export async function safeEgressFetch(url:string,init:RequestInit,allowedHosts:readonly string[],maxBytes:number){assertEgressUrl(url,allowedHosts);return governedFetch(url,init,maxBytes);}

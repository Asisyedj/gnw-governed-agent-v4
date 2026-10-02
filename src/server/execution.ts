import type { Db } from "./db/index.js";
import type { Env } from "./env.js";
import { audit } from "./audit.js";
import { governedFetch, assertEgressUrl } from "./security.js";
import { validateEnvelope, digestEnvelope, type ActionEnvelope } from "./action-envelope.js";
import { GovernanceService, type ApprovalRecord, type GovernanceRequest } from "./governance.js";
import { claimNonce, getInterlock, reserveBudget } from "./repo.js";

export type ExecutionContext = {
  db: Db; env: Env; taskId: number; tenantId: number; actorId: number; requestId: string;
  governanceRequest: GovernanceRequest; approval?: ApprovalRecord;
};
export type ExecutionResult = { success:boolean; output?:unknown; error?:string; durationMs:number };

export async function executeWithGovernance(ctx:ExecutionContext,envelope:ActionEnvelope,handler:()=>Promise<unknown>):Promise<ExecutionResult>{
  const start=Date.now();
  const governance=new GovernanceService({
    claimNonce:(kind,nonce,taskId)=>claimNonce(ctx.db,kind,nonce,taskId),
    reserveBudget:(tenantId,taskId,grantNonce,tokens,bytes)=>reserveBudget(ctx.db,tenantId,taskId,grantNonce,tokens,bytes),
    getInterlock:()=>getInterlock(ctx.db),
  },undefined,Date.now(),ctx.env.requireSignedGrants?{issuer:ctx.env.grantIssuer,publicKeyPem:ctx.env.grantPublicKeyPem}:undefined);
  try{
    validateEnvelope(envelope,Date.now(),300000,{taskId:ctx.taskId,tenantId:ctx.tenantId,actorId:ctx.actorId,grantId:ctx.governanceRequest.requestId,nonce:ctx.governanceRequest.nonce,operation:ctx.governanceRequest.operation,tool:ctx.governanceRequest.tool});
    const decision=await governance.authorize(ctx.governanceRequest,ctx.approval);
    if(!decision.allowed){
      await audit(ctx.db,{eventType:"governance.deny",actorId:ctx.actorId,tenantId:ctx.tenantId,taskId:ctx.taskId,resourceType:"tool",resourceId:envelope.tool,outcome:"denied",detail:{reason:decision.reason,actionDigest:decision.actionDigest},requestId:ctx.requestId},{required:true});
      return{success:false,error:decision.reason,durationMs:Date.now()-start};
    }
    const digest=digestEnvelope(envelope);
    await audit(ctx.db,{eventType:"tool.invoke",actorId:ctx.actorId,tenantId:ctx.tenantId,taskId:ctx.taskId,resourceType:"tool",resourceId:envelope.tool,outcome:"success",detail:{digest,actionDigest:decision.actionDigest,operation:envelope.operation},requestId:ctx.requestId},{required:true});
    const output=await handler();
    await audit(ctx.db,{eventType:"tool.result",actorId:ctx.actorId,tenantId:ctx.tenantId,taskId:ctx.taskId,resourceType:"tool",resourceId:envelope.tool,outcome:"success",detail:{digest,actionDigest:decision.actionDigest},requestId:ctx.requestId},{required:true});
    return{success:true,output,durationMs:Date.now()-start};
  }catch(err){
    const message=err instanceof Error?err.message:String(err);
    try{await audit(ctx.db,{eventType:"tool.deny",actorId:ctx.actorId,tenantId:ctx.tenantId,taskId:ctx.taskId,resourceType:"tool",resourceId:envelope.tool,outcome:"failure",detail:{error:message},requestId:ctx.requestId},{required:true});}catch{}
    return{success:false,error:message,durationMs:Date.now()-start};
  }
}

export async function safeEgressFetch(url:string,init:RequestInit,allowedHosts:readonly string[],maxBytes:number):Promise<Response>{assertEgressUrl(url,allowedHosts);return governedFetch(url,init,maxBytes);}

import type { Db } from "./db/index.js";
import type { Env } from "./env.js";
import { audit } from "./audit.js";
import { governedFetch, assertEgressUrl } from "./security.js";
import { claimNonce, getInterlock, reserveBudget } from "./repo.js";
import { GovernanceService, type ApprovalRecord, type GovernanceRequest } from "./governance.js";
import { validateEnvelope, digestEnvelope, type ActionEnvelope } from "./action-envelope.js";
export type ExecutionContext={db:Db;env:Env;taskId:number;tenantId:number;actorId:number;requestId:string;governanceRequest:GovernanceRequest;approval?:ApprovalRecord;grantId:string};
export type ExecutionResult={success:boolean;output?:unknown;error?:string;durationMs:number};
export async function executeWithGovernance(ctx:ExecutionContext,envelope:ActionEnvelope,handler:()=>Promise<unknown>):Promise<ExecutionResult>{
 const start=Date.now();const governance=new GovernanceService({claimNonce:(k,n,t)=>claimNonce(ctx.db,k,n,t),reserveBudget:(tenantId,taskId,nonce,tokens,bytes)=>reserveBudget(ctx.db,tenantId,taskId,nonce,tokens,bytes),getInterlock:()=>getInterlock(ctx.db)},undefined,()=>Date.now(),ctx.env.requireSignedGrants?{issuer:ctx.env.grantIssuer,publicKeyPem:ctx.env.grantPublicKeyPem}:undefined);
 try{
  validateEnvelope(envelope,Date.now(),300000,{taskId:ctx.taskId,tenantId:ctx.tenantId,actorId:ctx.actorId,grantId:ctx.grantId,nonce:ctx.governanceRequest.nonce,operation:ctx.governanceRequest.operation,tool:ctx.governanceRequest.tool});
  const d=await governance.authorize(ctx.governanceRequest,ctx.approval);
  if(!d.allowed){await audit(ctx.db,{eventType:"governance.deny",actorId:ctx.actorId,tenantId:ctx.tenantId,taskId:ctx.taskId,resourceType:"tool",resourceId:envelope.tool,outcome:"denied",detail:{reason:d.reason,actionDigest:d.actionDigest},requestId:ctx.requestId},{required:true});return{success:false,error:d.reason,durationMs:Date.now()-start};}
  const digest=digestEnvelope(envelope);
  await audit(ctx.db,{eventType:"tool.invoke",actorId:ctx.actorId,tenantId:ctx.tenantId,taskId:ctx.taskId,resourceType:"tool",resourceId:envelope.tool,outcome:"success",detail:{digest,operation:envelope.operation},requestId:ctx.requestId},{required:true});
  const output=await handler();
  await audit(ctx.db,{eventType:"tool.result",actorId:ctx.actorId,tenantId:ctx.tenantId,taskId:ctx.taskId,resourceType:"tool",resourceId:envelope.tool,outcome:"success",detail:{digest},requestId:ctx.requestId},{required:true});
  return{success:true,output,durationMs:Date.now()-start};
 }catch(e){const m=e instanceof Error?e.message:String(e);try{await audit(ctx.db,{eventType:"tool.deny",actorId:ctx.actorId,tenantId:ctx.tenantId,taskId:ctx.taskId,resourceType:"tool",resourceId:envelope.tool,outcome:"failure",detail:{error:m},requestId:ctx.requestId},{required:true});}catch{}return{success:false,error:m,durationMs:Date.now()-start};}
}
export async function safeEgressFetch(url:string,init:RequestInit,allowedHosts:readonly string[],maxBytes:number){assertEgressUrl(url,allowedHosts);return governedFetch(url,init,maxBytes);}
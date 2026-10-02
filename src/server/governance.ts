import { randomUUID } from "node:crypto";
import { canonicalize, sha256, verifyGrantSignature } from "./security.js";
import { verifyRuntimeAttestation, type RuntimeAttestation } from "./attestation.js";
import { issueCapabilityLease, type CapabilityLease } from "./capability.js";
import { AGENT_TOOL_SCOPES, CLASSIFICATIONS, SPECIALIST_AGENTS, type Classification, type SpecialistAgent } from "../shared/types.js";

export type GovernanceRequest={requestId:string;subject:string;tenant:string;role:string;purpose:string;classification:Classification;operation:string;resource:string;agent:SpecialistAgent;tool:string;scope:string;budgetTokens:number;budgetBytes:number;issuedAt:number;expiresAt:number;nonce:string;taskId?:number;normalizedParameters?:Record<string,unknown>;inputDigest?:string;envelopeDigest?:string;providerParameters?:Record<string,unknown>;provenance?:Record<string,{value:unknown;source:string;trust:string}>;capability?:string;outputConstraints?:Record<string,unknown>;budgetReservationTokens?:number;budgetReservationBytes?:number;issuer?:string;signature?:string;runtimeAttestation?:RuntimeAttestation};
export type ApprovalRecord={approvalId:string|number;requestId?:string;actionDigest:string;tenant:string;status:"pending"|"approved"|"denied"|"expired";approverId?:number|string;approverRole?:string;requestedBy?:number|string;expiresAt:number;nonce:string};
export type GovernanceDecision={allowed:boolean;status:"ALLOW"|"DENY"|"STOP";reason:string;actionDigest:string;requestId:string;capabilityLease?:CapabilityLease};
export type Interlock={killSwitch:boolean;circuitOpen:boolean;generation?:number;reason?:string|null};
export class GovernanceError extends Error{constructor(public readonly code:string,message=code){super(message);this.name="GovernanceError";}}
export interface GovernanceStores{claimNonce(kind:string,nonce:string,taskId?:number):Promise<boolean>;reserveBudget?(tenantId:number,taskId:number,grantNonce:string,tokens:number,bytes:number):Promise<boolean>;getInterlock():Promise<Interlock>;persistCapabilityLease?(lease:CapabilityLease):Promise<unknown>}
export type GovernanceLimits={maxBudgetTokens:number;maxBudgetBytes:number;maxGrantTtlMs:number};
const DEFAULT_LIMITS:GovernanceLimits={maxBudgetTokens:100000,maxBudgetBytes:50000000,maxGrantTtlMs:600000};
export function requiresHumanApproval(r:Pick<GovernanceRequest,"operation"|"classification"|"agent"|"tool">){return r.operation==="provider_job"||r.classification==="restricted"||r.tool==="video.provider_job";}
export function digestRequest(r:GovernanceRequest){return sha256(`GNW-ACTION-ENVELOPE-V1|${canonicalize({requestId:r.requestId,subject:r.subject,tenant:r.tenant,role:r.role,purpose:r.purpose,classification:r.classification,operation:r.operation,resource:r.resource,agent:r.agent,tool:r.tool,scope:r.scope,normalizedParameters:r.normalizedParameters??{},inputDigest:r.inputDigest??"",envelopeDigest:r.envelopeDigest??"",providerParameters:r.providerParameters??null,outputConstraints:r.outputConstraints??null,budgetTokens:r.budgetTokens,budgetBytes:r.budgetBytes,budgetReservationTokens:r.budgetReservationTokens??r.budgetTokens,budgetReservationBytes:r.budgetReservationBytes??r.budgetBytes,provenance:r.provenance??{}})}`);}
export class GovernanceService{
 constructor(private readonly stores:GovernanceStores,private readonly limits:GovernanceLimits=DEFAULT_LIMITS,private readonly now:()=>number=Date.now,private readonly grantVerifier?:{issuer:string;publicKeyPem:string},private readonly leaseSigner?:{issuer:string;privateKeyPem:string;ttlMs:number},private readonly attestationVerifier?:{issuer:string;publicKeyPem:string;expectedMeasurement?:string;maxAgeMs?:number},private readonly requireAttestation=false){}
 digest(r:GovernanceRequest){return digestRequest(r);}
 async authorize(r:GovernanceRequest,a?:ApprovalRecord):Promise<GovernanceDecision>{
  const actionDigest=this.digest(r),base={actionDigest,requestId:r.requestId};let interlock:Interlock;
  try{interlock=await this.stores.getInterlock();}catch{return{allowed:false,status:"STOP",reason:"safety_interlock",...base};}
  if(interlock.killSwitch||interlock.circuitOpen)return{allowed:false,status:"STOP",reason:"safety_interlock",...base};
  try{
   this.assertBoundContext(r);
   if(this.grantVerifier&& (r.issuer!==this.grantVerifier.issuer||!r.signature||!verifyGrantSignature(r as unknown as Record<string,unknown>,r.issuer,r.signature,this.grantVerifier.publicKeyPem)))throw new GovernanceError("invalid_grant_signature");
   const now=this.now();
   if(!Number.isInteger(r.issuedAt)||!Number.isInteger(r.expiresAt))throw new GovernanceError("grant_time_invalid");
   if(r.expiresAt<=r.issuedAt||r.expiresAt-r.issuedAt>this.limits.maxGrantTtlMs||now<r.issuedAt||now>=r.expiresAt)throw new GovernanceError("grant_expired");
   if(!Number.isInteger(r.budgetTokens)||r.budgetTokens<=0||r.budgetTokens>this.limits.maxBudgetTokens)throw new GovernanceError("budget_tokens_invalid");
   if(!Number.isInteger(r.budgetBytes)||r.budgetBytes<=0||r.budgetBytes>this.limits.maxBudgetBytes)throw new GovernanceError("budget_bytes_invalid");
   const rt=r.budgetReservationTokens??r.budgetTokens,rb=r.budgetReservationBytes??r.budgetBytes;
   if(!Number.isInteger(rt)||rt<=0||rt>r.budgetTokens||!Number.isInteger(rb)||rb<=0||rb>r.budgetBytes)throw new GovernanceError("budget_reservation_invalid");
   if(!(AGENT_TOOL_SCOPES[r.agent]??[]).includes(r.tool))throw new GovernanceError("tool_not_allowed");
   if(r.scope!==r.tool)throw new GovernanceError("scope_binding");
   if(this.requireAttestation&&r.classification==="restricted"){
    if(!this.attestationVerifier||!r.runtimeAttestation||!verifyRuntimeAttestation(r.runtimeAttestation,this.attestationVerifier,now))throw new GovernanceError("runtime_attestation_required");
   }
   if(requiresHumanApproval(r)){
    if(!a||a.status!=="approved")throw new GovernanceError("approval_required");
    if(a.actionDigest!==actionDigest||a.tenant!==r.tenant||(a.requestId&&a.requestId!==r.requestId))throw new GovernanceError("approval_binding");
    if(a.expiresAt<=now)throw new GovernanceError("approval_expired");
    if(a.approverId!==undefined&&a.requestedBy!==undefined&&String(a.approverId)===String(a.requestedBy)&&a.approverRole!=="admin")throw new GovernanceError("separation_of_duties");
    if(!(await this.stores.claimNonce("approval",a.nonce)))throw new GovernanceError("approval_replay");
   }
   if(!(await this.stores.claimNonce("grant",r.nonce)))throw new GovernanceError("grant_replay");
   if(r.taskId&&this.stores.reserveBudget&&!(await this.stores.reserveBudget(Number(r.tenant),r.taskId,r.nonce,rt,rb)))throw new GovernanceError("aggregate_budget_exhausted");
   let capabilityLease:CapabilityLease|undefined;
   if(this.leaseSigner){capabilityLease=issueCapabilityLease({requestId:r.requestId,actionDigest,subject:r.subject,tenant:r.tenant,taskId:r.taskId??0,actorUserId:Number(r.subject),capability:r.capability??r.tool,destination:typeof r.providerParameters?.endpoint==="string"?r.providerParameters.endpoint:null,ttlMs:Math.min(this.leaseSigner.ttlMs,Math.max(1,r.expiresAt-now)),interlockGeneration:interlock.generation??0,issuer:this.leaseSigner.issuer,privateKeyPem:this.leaseSigner.privateKeyPem},now);if(this.stores.persistCapabilityLease)await this.stores.persistCapabilityLease(capabilityLease);}
   return capabilityLease ? {allowed:true,status:"ALLOW",reason:"governance_admitted",capabilityLease,...base} : {allowed:true,status:"ALLOW",reason:"governance_admitted",...base};
  }catch(e){return{allowed:false,status:"DENY",reason:e instanceof GovernanceError?e.code:"governance_failure",...base};}
 }
 private assertBoundContext(r:GovernanceRequest){const req=[r.requestId,r.subject,r.tenant,r.role,r.purpose,r.resource,r.agent,r.tool,r.scope,r.nonce];if(req.some(v=>typeof v!=="string"||!v.trim()))throw new GovernanceError("context_missing");if(!SPECIALIST_AGENTS.includes(r.agent))throw new GovernanceError("agent_not_allowed");if(!r.operation?.trim())throw new GovernanceError("operation_missing");if(!CLASSIFICATIONS.includes(r.classification))throw new GovernanceError("classification_invalid");if(r.purpose.length>200||r.resource.length>500||r.tool.length>200||r.scope.length>200)throw new GovernanceError("context_too_large");if(r.normalizedParameters!==undefined&&(typeof r.normalizedParameters!=="object"||Array.isArray(r.normalizedParameters)))throw new GovernanceError("parameters_invalid");if(!r.envelopeDigest||!/^[0-9a-f]{64}$/.test(r.envelopeDigest))throw new GovernanceError("envelope_digest_missing");}
}
export class MemoryGovernanceStores implements GovernanceStores{private readonly used=new Set<string>();private interlock:Interlock={killSwitch:false,circuitOpen:false,generation:0};async claimNonce(k:string,n:string){const key=`${k}:${n}`;if(this.used.has(key))return false;this.used.add(key);return true;}async reserveBudget(){return true;}async getInterlock(){return this.interlock;}setInterlock(next:Partial<Interlock>){this.interlock={...this.interlock,...next,generation:(this.interlock.generation??0)+1};}}
export function newGrant(input:Omit<GovernanceRequest,"requestId"|"nonce"|"issuedAt"|"expiresAt">&{ttlMs?:number}):GovernanceRequest{const issuedAt=Date.now()-1;return{...input,requestId:randomUUID(),nonce:randomUUID(),issuedAt,expiresAt:issuedAt+(input.ttlMs??600000)};}

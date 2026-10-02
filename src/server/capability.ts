import { randomBytes } from "node:crypto";
import { signGrant, sha256 } from "./security.js";

export type CapabilityLease={
  leaseId:string; requestId:string; actionDigest:string; subject:string; tenant:string;
  taskId:number; actorUserId:number; capability:string; destination:string|null;
  issuedAt:number; expiresAt:number; interlockGeneration:number; issuer:string; signature:string;
  consumed?:boolean;
};

export function generateNonce(bytes=16){return randomBytes(bytes).toString("hex");}

export function issueCapabilityLease(input:{
  requestId:string; actionDigest:string; subject:string; tenant:string; taskId:number; actorUserId:number;
  capability:string; destination:string|null; ttlMs:number; interlockGeneration:number; issuer:string; privateKeyPem:string;
},now=Date.now()):CapabilityLease{
  if(!input.privateKeyPem) throw new Error("lease_signing_key_missing");
  if(!Number.isFinite(input.ttlMs)||input.ttlMs<=0) throw new Error("lease_ttl_invalid");
  const leaseId=generateNonce(24);
  const base={leaseId,requestId:input.requestId,actionDigest:input.actionDigest,subject:input.subject,tenant:input.tenant,taskId:input.taskId,actorUserId:input.actorUserId,capability:input.capability,destination:input.destination,issuedAt:now,expiresAt:now+input.ttlMs,interlockGeneration:input.interlockGeneration,issuer:input.issuer};
  const {signature}=signGrant(base,input.issuer,input.privateKeyPem);
  return {...base,signature};
}

export function capabilityLeaseDigest(lease:CapabilityLease){return sha256(JSON.stringify([lease.leaseId,lease.requestId,lease.actionDigest,lease.subject,lease.tenant,lease.taskId,lease.actorUserId,lease.capability,lease.destination,lease.issuedAt,lease.expiresAt,lease.interlockGeneration,lease.issuer]));}
export function isLeaseValid(lease:CapabilityLease,nowMs=Date.now()){return lease.consumed!==true&&lease.expiresAt>nowMs;}

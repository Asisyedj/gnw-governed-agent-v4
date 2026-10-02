import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyRuntimeAttestation } from "../../server/attestation.js";
import { verifyThresholdAttestation } from "../../server/trust-anchor.js";
import { GovernanceService, MemoryGovernanceStores, digestRequest, type GovernanceRequest } from "../../server/governance.js";

const keys=generateKeyPairSync("ed25519",{privateKeyEncoding:{type:"pkcs8",format:"pem"},publicKeyEncoding:{type:"spki",format:"pem"}});
const thresholdKeys=[1,2,3].map(()=>generateKeyPairSync("ed25519",{privateKeyEncoding:{type:"pkcs8",format:"pem"},publicKeyEncoding:{type:"spki",format:"pem"}}));
const now=1_800_000_000_000;
const measurement="a".repeat(64);
const actionDigest="d".repeat(64);
const thresholdPayload=(nonce:string)=>`GNW-TRUST-ANCHOR-V1|${actionDigest}|${measurement}|${nonce}`;
const base=():GovernanceRequest=>({
 requestId:"r",subject:"1",tenant:"1",role:"operator",purpose:"restricted-test",classification:"restricted",
 operation:"search",resource:"knowledge",agent:"research",tool:"knowledge.search",scope:"knowledge.search",
 budgetTokens:1000,budgetBytes:10000,issuedAt:now-1000,expiresAt:now+60000,nonce:"n-1",taskId:1,envelopeDigest:"0".repeat(64)
});
function makeAttestation(){
 const issuer="tee-verifier";
 const nonce="b".repeat(32);
 const issuedAt=now-1000;
 const expiresAt=now+30000;
 const payload=`GNW-TEE-ATTESTATION-V1|${issuer}|${measurement}|${nonce}|${issuedAt}|${expiresAt}`;
 return {issuer,measurement,nonce,issuedAt,expiresAt,signature:sign(null,Buffer.from(payload),keys.privateKey).toString("hex")};
}

describe("runtime attestation",()=>{
 it("accepts a valid signed measurement",()=>{
   const a=makeAttestation();
   expect(verifyRuntimeAttestation(a,{issuer:"tee-verifier",publicKeyPem:keys.publicKey,expectedMeasurement:measurement,maxAgeMs:120000},now)).toBe(true);
 });
 it("rejects tampering, wrong measurement and expiry",()=>{
   const a=makeAttestation();
   expect(verifyRuntimeAttestation({...a,measurement:"c".repeat(64)},{issuer:"tee-verifier",publicKeyPem:keys.publicKey,expectedMeasurement:measurement},now)).toBe(false);
   expect(verifyRuntimeAttestation({...a,expiresAt:now-1},{issuer:"tee-verifier",publicKeyPem:keys.publicKey},now)).toBe(false);
   expect(verifyRuntimeAttestation({...a,nonce:"c".repeat(32)},{issuer:"tee-verifier",publicKeyPem:keys.publicKey},now)).toBe(false);
 });
 it("binds attestation evidence into the action digest",()=>{
   const a=makeAttestation();
   const r=base();
   expect(digestRequest({...r,runtimeAttestation:a})).not.toBe(digestRequest({...r,runtimeAttestation:{...a,nonce:"c".repeat(32)}}));
 });
 it("fails closed for restricted governance when attestation is missing",async()=>{
   const g=new GovernanceService(new MemoryGovernanceStores(),undefined,()=>now,undefined,undefined,{issuer:"tee-verifier",publicKeyPem:keys.publicKey,expectedMeasurement:measurement,maxAgeMs:120000},true);
   const r=await g.authorize(base());
   expect(r.allowed).toBe(false);
   expect(r.reason).toBe("runtime_attestation_required");
 });
 it("admits restricted governance only with valid attestation and approval",async()=>{
   const g=new GovernanceService(new MemoryGovernanceStores(),undefined,()=>now,undefined,undefined,{issuer:"tee-verifier",publicKeyPem:keys.publicKey,expectedMeasurement:measurement,maxAgeMs:120000},true);
   const request={...base(),runtimeAttestation:makeAttestation()};
   const approval={approvalId:1,requestId:request.requestId,actionDigest:g.digest(request),tenant:request.tenant,status:"approved" as const,approverId:2,requestedBy:1,approverRole:"admin",expiresAt:now+5000,nonce:"approval-1"};
   const r=await g.authorize(request,approval);
   expect(r.allowed).toBe(true);
 });
 it("accepts a valid 2-of-3 threshold trust anchor",()=>{
   const nonce="e".repeat(32);
   const signatures=thresholdKeys.slice(0,2).map((k,i)=>({participantId:`p${i+1}`,signature:sign(null,Buffer.from(thresholdPayload(nonce)),k.privateKey).toString("hex")}));
   const participants=Object.fromEntries(thresholdKeys.map((k,i)=>[`p${i+1}`,k.publicKey]));
   expect(verifyThresholdAttestation(actionDigest,measurement,nonce,signatures,{threshold:2,participants,requireTee:true})).toBe(true);
 });
 it("rejects duplicate, tampered and below-threshold trust-anchor votes",()=>{
   const nonce="e".repeat(32);
   const participants=Object.fromEntries(thresholdKeys.map((k,i)=>[`p${i+1}`,k.publicKey]));
   const one={participantId:"p1",signature:sign(null,Buffer.from(thresholdPayload(nonce)),thresholdKeys[0]!.privateKey).toString("hex")};
   expect(verifyThresholdAttestation(actionDigest,measurement,nonce,[one,one],{threshold:2,participants,requireTee:true})).toBe(false);
   expect(verifyThresholdAttestation(actionDigest,measurement,nonce,[{...one,signature:"00"}],{threshold:2,participants,requireTee:true})).toBe(false);
 });
 it("fails closed when restricted governance requires but lacks threshold trust anchor",async()=>{
   const g=new GovernanceService(new MemoryGovernanceStores(),undefined,()=>now,undefined,undefined,{issuer:"tee-verifier",publicKeyPem:keys.publicKey,expectedMeasurement:measurement,maxAgeMs:120000},true,undefined,true);
   const request={...base(),runtimeAttestation:makeAttestation()};
   const approval={approvalId:1,requestId:request.requestId,actionDigest:g.digest(request),tenant:request.tenant,status:"approved" as const,approverId:2,requestedBy:1,approverRole:"admin",expiresAt:now+5000,nonce:"approval-2"};
   const r=await g.authorize(request,approval);
   expect(r.allowed).toBe(false);
   expect(r.reason).toBe("threshold_trust_anchor_not_configured");
 });
});

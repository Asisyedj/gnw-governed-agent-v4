import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { digestEnvelope, validateEnvelope } from "../../server/action-envelope.js";
import { capabilityLeaseDigest, generateNonce, issueCapabilityLease, isLeaseValid } from "../../server/capability.js";
import { callExecutor } from "../../server/executor-client.js";
import { executorBodyDigest, makeExecutorToken, verifyExecutorToken } from "../../executor/auth.js";
import { GovernanceService, MemoryGovernanceStores, newGrant, requiresHumanApproval, type GovernanceRequest } from "../../server/governance.js";
import { buildTrajectoryChain, computeTrajectoryRoot, verifyTrajectoryIntegrity } from "../../server/invariants.js";
import { recordRequest, renderMetrics } from "../../server/metrics.js";
import { assertEgressUrl, assertHttpsUrl, canonicalize, governedFetch, isPrivateOrLocalHost, sha256, signGrant, verifyGrantSignature } from "../../server/security.js";

const keys=generateKeyPairSync("ed25519",{privateKeyEncoding:{type:"pkcs8",format:"pem"},publicKeyEncoding:{type:"spki",format:"pem"}});
const now=Date.now();
const baseRequest=():GovernanceRequest=>({
  requestId:"req-1",subject:"1",tenant:"1",role:"operator",purpose:"test",classification:"public",
  operation:"search",resource:"knowledge",agent:"research",tool:"knowledge.search",scope:"knowledge.search",
  budgetTokens:1000,budgetBytes:10000,issuedAt:now-1000,expiresAt:now+10000,nonce:"grant-1",taskId:1,
});

describe("production control primitives",()=>{
 it("binds and validates action envelopes",()=>{
   const env={taskId:"1",tenantId:"1",actorId:"7",operation:"search",tool:"knowledge.search",parameters:{q:"x"},grantId:"g",nonce:"n",issuedAt:now};
   expect(digestEnvelope(env)).toMatch(/^[0-9a-f]{64}$/);
   expect(()=>validateEnvelope(env,now,300000,{taskId:1,tenantId:1,actorId:7,grantId:"g",nonce:"n",operation:"search",tool:"knowledge.search"})).not.toThrow();
   expect(()=>validateEnvelope(env,now,300000,{taskId:2,tenantId:1,actorId:7,grantId:"g",nonce:"n",operation:"search",tool:"knowledge.search"})).toThrow("context_binding");
   expect(()=>validateEnvelope({...env,issuedAt:now-400000},now)).toThrow("outside window");
 });
 it("issues scoped capability leases and rejects expiry/consumption",()=>{
   const lease=issueCapabilityLease({requestId:"r",actionDigest:"d",subject:"1",tenant:"1",taskId:1,actorUserId:1,capability:"knowledge.search",destination:null,ttlMs:1000,interlockGeneration:3,issuer:"gnw-test",privateKeyPem:keys.privateKey},now);
   expect(isLeaseValid(lease,now+500)).toBe(true);
   expect(isLeaseValid({...lease,consumed:true},now+500)).toBe(false);
   expect(isLeaseValid(lease,now+1001)).toBe(false);
   expect(capabilityLeaseDigest(lease)).toMatch(/^[0-9a-f]{64}$/);
   expect(generateNonce(12)).toHaveLength(24);
 });
 it("covers governance deny/allow/replay/approval/interlock paths",async()=>{
   expect(requiresHumanApproval({operation:"provider_job",classification:"public",agent:"video_producer",tool:"video.provider_job"})).toBe(true);
   const stores=new MemoryGovernanceStores();
   const g=new GovernanceService(stores,undefined,()=>now);
   const valid=baseRequest();
   expect((await g.authorize(valid)).allowed).toBe(true);
   expect((await g.authorize(valid)).allowed).toBe(false);
   const locked=new MemoryGovernanceStores();locked.setInterlock({killSwitch:true});
   expect((await new GovernanceService(locked,undefined,()=>now).authorize({...valid,nonce:"locked"})).status).toBe("STOP");
   expect((await g.authorize({...valid,nonce:"bad-tool",tool:"file.write",scope:"file.write"})).allowed).toBe(false);
   expect((await g.authorize({...valid,nonce:"bad-scope",scope:"other"})).allowed).toBe(false);
   expect((await g.authorize({...valid,nonce:"bad-budget",budgetTokens:0})).allowed).toBe(false);
   expect((await g.authorize({...valid,nonce:"bad-time",expiresAt:now-1})).allowed).toBe(false);
   const approved=baseRequest();approved.operation="provider_job";approved.tool="video.provider_job";approved.scope="video.provider_job";approved.agent="video_producer";approved.nonce="approval-grant";
   expect((await g.authorize(approved)).reason).toBe("approval_required");
   const approval={approvalId:1,requestId:"req-1",actionDigest:g.digest(approved),tenant:"1",status:"approved" as const,approverId:2,requestedBy:1,expiresAt:now+5000,nonce:"approval-1"};
   expect((await g.authorize(approved,approval)).allowed).toBe(true);
   expect((await g.authorize(approved,{...approval,nonce:"approval-1"})).allowed).toBe(false);
 });
 it("covers signed grants",()=>{
   const req=baseRequest();
   const signed=signGrant({...req}, "gnw-test", keys.privateKey);
   expect(verifyGrantSignature({...req},signed.issuer,signed.signature,keys.publicKey)).toBe(true);
   expect(verifyGrantSignature({...req, purpose:"tampered"},signed.issuer,signed.signature,keys.publicKey)).toBe(false);
   const leaseRequest=newGrant(req);expect(leaseRequest.requestId).toBeTruthy();expect(leaseRequest.nonce).toBeTruthy();
 });
 it("verifies trajectory tamper resistance",()=>{
   const steps=[{stepIndex:0,inputDigest:"a".repeat(64),outputDigest:"b".repeat(64)},{stepIndex:1,inputDigest:"c".repeat(64),outputDigest:null}];
   const chain=buildTrajectoryChain(steps);
   const persisted=steps.map((s,i)=>({...s,chainHash:chain[i]!.chainHash,prevChainHash:i===0?null:chain[i-1]!.chainHash}));
   expect(verifyTrajectoryIntegrity(persisted)).toBe(true);
   expect(verifyTrajectoryIntegrity([{...persisted[0]!,chainHash:"0".repeat(64)},persisted[1]!])).toBe(false);
   expect(computeTrajectoryRoot(steps)).toBe(chain.at(-1)!.chainHash);
 });
 it("covers security primitives and fail-closed egress",async()=>{
   expect(canonicalize({b:1,a:[2,3]})).toBe('{"a":[2,3],"b":1}');
   expect(sha256("x")).toMatch(/^[0-9a-f]{64}$/);
   expect(isPrivateOrLocalHost("localhost")).toBe(true);
   expect(isPrivateOrLocalHost("example.com")).toBe(false);
   expect(()=>assertHttpsUrl("http://example.com")).toThrow("https_required");
   expect(()=>assertHttpsUrl("https://u:p@example.com")).toThrow("url_credentials_forbidden");
   expect(assertEgressUrl("https://api.example.com/x",["api.example.com"]).hostname).toBe("api.example.com");
   expect(()=>assertEgressUrl("https://api.example.com/x",[])).toThrow("not_allowlisted");
   await expect(governedFetch("https://127.0.0.1/")).rejects.toThrow("unsafe_dns_destination");
   await expect(governedFetch("https://example.com/",{redirect:"follow"})).rejects.toThrow("redirects_must_be_manual");
 });
 it("covers executor request-bound credentials",async()=>{
   const payload='{"requestId":"r","issuedAt":1700000000000}';
   const d=executorBodyDigest(payload);
   const token=makeExecutorToken("secret","r",1700000000000,d);
   expect(verifyExecutorToken(token,"secret","r",1700000000000,d,1700000000000)).toBe(true);
   expect(verifyExecutorToken(token,"secret","r",1700000000000,d+"x",1700000000000)).toBe(false);
   expect(verifyExecutorToken(token,"secret","r",1700000000000,d,1700000061000)).toBe(false);
   const env={executorUrl:"http://executor.local",executorSecret:"s",isProduction:true} as any;
   await expect(callExecutor(env,["echo","x"])).rejects.toThrow("executor_https_required");
   expect(generateNonce()).toHaveLength(32);
 });
 it("renders metrics and records HTTP observations",()=>{
   recordRequest("GET","/api/health",200,100);
   const text=renderMetrics({killSwitch:false,circuitOpen:true});
   expect(text).toContain("gnw_kill_switch_active 0");
   expect(text).toContain("gnw_circuit_breaker_open 1");
   expect(text).toContain('http_requests_total{app="gnw",method="GET",route="/api/health",status="200"} 1');
 });
});

vi.mock("../../server/audit.js",()=>({audit:vi.fn(async()=>undefined)}));
vi.mock("../../server/repo.js",()=>({
 claimNonce:vi.fn(async()=>true),
 getInterlock:vi.fn(async()=>({killSwitch:false,circuitOpen:false,generation:0})),
 reserveBudget:vi.fn(async()=>true),
}));
describe("governed execution boundary",()=>{
 it("runs handler only after governance admission",async()=>{
   const {executeWithGovernance}=await import("../../server/execution.js");
   const handler=vi.fn(async()=>({ok:true}));
   const ctx={
     db:{},env:{requireSignedGrants:false,grantIssuer:"x",grantPublicKeyPem:"",executorSecret:"",executorUrl:"",} as any,
     taskId:1,tenantId:1,actorId:1,requestId:"req-1",grantId:"g",
     governanceRequest:baseRequest(),
   } as any;
   const result=await executeWithGovernance(ctx,{taskId:"1",tenantId:"1",actorId:"1",operation:"search",tool:"knowledge.search",parameters:{},grantId:"g",nonce:"grant-exec-1",issuedAt:now},handler);
   expect(result.success).toBe(true);
   expect(handler).toHaveBeenCalledTimes(1);
 });
});

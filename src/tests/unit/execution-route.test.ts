import { describe, expect, it, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { digestEnvelope } from "../../server/action-envelope.js";
import { digestRequest, type GovernanceRequest } from "../../server/governance.js";

const executeWithGovernance=vi.fn();
const executeGovernedTool=vi.fn();
const resolveSession=vi.fn();
const findTaskById=vi.fn();
const findUserById=vi.fn();
const findApprovalById=vi.fn();
const createApproval=vi.fn();
const insertAuditLog=vi.fn(async()=>undefined);
const updateTaskStatus=vi.fn(async()=>undefined);
const enqueueJob=vi.fn();
const requestJobCancellation=vi.fn();
const digestQueuePayload=vi.fn(()=> "d".repeat(64));
const GOVERNED_EXECUTION_JOB="governed_tool_execution";
const QUEUED_JOB_ID="a4d1b14a-5f9a-4d72-9d42-0d1b01034b5a";

vi.mock("../../server/execution.js",()=>({executeWithGovernance,executeGovernedTool}));
vi.mock("../../server/routes/auth.js",()=>({resolveSession}));
vi.mock("../../server/db/index.js",()=>({pgPool:{}}));
vi.mock("../../server/orchestration/durable-queue.js",()=>({enqueueJob,requestJobCancellation}));
vi.mock("../../server/orchestration/queue-payload.js",()=>({digestQueuePayload,GOVERNED_EXECUTION_JOB}));
vi.mock("../../server/repo.js",()=>({
  createApproval,findApprovalById,findTaskById,findUserById,insertAuditLog,updateTaskStatus,
}));

async function makeApp():Promise<FastifyInstance>{
  const {executionRoutes}=await import("../../server/routes/execution.js");
  const app=Fastify();
  app.decorate("db",{} as never);
  await app.register(executionRoutes,{prefix:"/api/tasks"});
  await app.ready();
  return app;
}

function makeRequest():{grant:GovernanceRequest;envelope:Record<string,unknown>}{
  const envelope={
    taskId:"1",tenantId:"1",actorId:"1",operation:"search",tool:"knowledge.search",
    parameters:{q:"governed"},grantId:"grant-1",nonce:"nonce-1",issuedAt:Date.now(),
  };
  const grant={
    requestId:"req-1",subject:"1",tenant:"1",role:"operator",purpose:"test",
    classification:"internal",operation:"search",resource:"knowledge",agent:"research",
    tool:"knowledge.search",scope:"knowledge.search",budgetTokens:1000,budgetBytes:10000,
    issuedAt:Date.now()-1000,expiresAt:Date.now()+300000,nonce:"nonce-1",taskId:1,
    envelopeDigest:digestEnvelope(envelope as never),
  } as GovernanceRequest;
  return {grant,envelope};
}

describe("authenticated governed execution route",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    resolveSession.mockResolvedValue({userId:1,tenantId:1});
    findUserById.mockResolvedValue({id:1,tenantId:1,role:"operator"});
    findTaskById.mockResolvedValue({
      id:1,tenantId:1,classification:"standard",status:"pending",
      budgetTokensAllocated:10000,budgetTokensUsed:0,budgetBytesAllocated:100000,budgetBytesUsed:0,
    });
    executeWithGovernance.mockResolvedValue({success:true,output:{ok:true},durationMs:1});
    executeGovernedTool.mockResolvedValue({stdout:"ok",stderr:"",exitCode:0});
    enqueueJob.mockResolvedValue({id:QUEUED_JOB_ID,status:"pending",payload_digest:"d".repeat(64)});
    requestJobCancellation.mockResolvedValue({id:QUEUED_JOB_ID,status:"cancel_requested"});
    findApprovalById.mockResolvedValue(undefined);
    digestQueuePayload.mockReturnValue("d".repeat(64));
  });

  it("registers a reachable execute endpoint and never dispatches the tool outside governance",async()=>{
    const app=await makeApp();
    const {grant,envelope}=makeRequest();
    const response=await app.inject({method:"POST",url:"/api/tasks/1/execute",payload:{grant,envelope}});
    expect(response.statusCode).toBe(200);
    expect(executeWithGovernance).toHaveBeenCalledTimes(1);
    expect(executeGovernedTool).not.toHaveBeenCalled();

    const callback=executeWithGovernance.mock.calls[0]?.[2] as (()=>Promise<unknown>)|undefined;
    expect(callback).toBeTypeOf("function");
    await callback?.();
    expect(executeGovernedTool).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("rejects authenticated cross-tenant execution before governance",async()=>{
    const app=await makeApp();
    const {grant,envelope}=makeRequest();
    const tampered={...grant,tenant:"2"};
    const response=await app.inject({method:"POST",url:"/api/tasks/1/execute",payload:{grant:tampered,envelope}});
    expect(response.statusCode).toBe(403);
    expect(executeWithGovernance).not.toHaveBeenCalled();
    expect(executeGovernedTool).not.toHaveBeenCalled();
    await app.close();
  });

  it("enqueues low-impact execution with tenant and payload digest binding",async()=>{
    const app=await makeApp();
    const {grant,envelope}=makeRequest();
    const response=await app.inject({method:"POST",url:"/api/tasks/1/execute/queued",payload:{grant,envelope}});
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ok:true,queued:true,taskId:1,jobId:QUEUED_JOB_ID,status:"pending"});
    expect(enqueueJob).toHaveBeenCalledTimes(1);
    const [pool,input]=enqueueJob.mock.calls[0] as [unknown,Record<string,unknown>];
    expect(pool).toEqual({});
    expect(input).toMatchObject({tenantId:1,jobType:GOVERNED_EXECUTION_JOB,payloadDigest:"d".repeat(64),idempotencyKey:"execution:req-1",maxAttempts:1});
    expect((input.payload as Record<string,unknown>).requestId).toBe("req-1");
    expect(executeGovernedTool).not.toHaveBeenCalled();
    await app.close();
  });

  it("queues a high-impact action only against the exact approved digest in GNW's existing approvals store",async()=>{
    const app=await makeApp();
    const {grant,envelope}=makeRequest();
    const approvalGrant:GovernanceRequest={...grant,operation:"provider_job",tool:"video.provider_job",scope:"video.provider_job",agent:"video_producer"};
    const approvalEnvelope={...envelope,operation:"provider_job",tool:"video.provider_job"};
    approvalGrant.envelopeDigest=digestEnvelope(approvalEnvelope as never);
    const actionDigest=digestRequest(approvalGrant);
    findApprovalById.mockResolvedValue({
      id:10,tenantId:1,taskId:1,requestedByUserId:1,reviewedByUserId:2,
      actionDigest,requestId:"req-1",status:"approved",expiresAt:new Date(Date.now()+300000),nonce:"approval-nonce",
    });
    const response=await app.inject({method:"POST",url:"/api/tasks/1/execute/queued",payload:{grant:approvalGrant,envelope:approvalEnvelope,approvalId:10}});
    expect(response.statusCode).toBe(202);
    expect(findApprovalById).toHaveBeenCalledWith(expect.anything(),10,1);
    expect(enqueueJob).toHaveBeenCalledTimes(1);
    expect((enqueueJob.mock.calls[0]?.[1] as {payload:Record<string,unknown>}).payload.approvalId).toBe(10);
    await app.close();
  });

  it("rejects high-impact queue requests when the stored approval digest differs",async()=>{
    const app=await makeApp();
    const {grant,envelope}=makeRequest();
    const approvalGrant={...grant,operation:"provider_job",tool:"video.provider_job",scope:"video.provider_job",agent:"video_producer"};
    const approvalEnvelope={...envelope,operation:"provider_job",tool:"video.provider_job"};
    approvalGrant.envelopeDigest=digestEnvelope(approvalEnvelope as never);
    findApprovalById.mockResolvedValue({
      id:10,tenantId:1,taskId:1,requestedByUserId:1,reviewedByUserId:2,
      actionDigest:"0".repeat(64),requestId:"req-1",status:"approved",expiresAt:new Date(Date.now()+300000),nonce:"approval-nonce",
    });
    const response=await app.inject({method:"POST",url:"/api/tasks/1/execute/queued",payload:{grant:approvalGrant,envelope:approvalEnvelope,approvalId:10}});
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("approval_binding");
    expect(enqueueJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("persists cancellation as a request until the worker confirms it",async()=>{
    const app=await makeApp();
    const response=await app.inject({method:"POST",url:`/api/tasks/1/execute/jobs/${QUEUED_JOB_ID}/cancel`});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ok:true,jobId:QUEUED_JOB_ID,status:"cancel_requested",cancellationConfirmed:false});
    expect(requestJobCancellation).toHaveBeenCalledWith(expect.anything(),1,QUEUED_JOB_ID,1,1);
    expect(updateTaskStatus).not.toHaveBeenCalledWith(expect.anything(),expect.anything(),expect.anything(),"cancelled",expect.anything());
    await app.close();
  });

  it("creates an approval record without consuming the grant",async()=>{
    const app=await makeApp();
    const {grant,envelope}=makeRequest();
    const approvalGrant={...grant,operation:"provider_job",tool:"video.provider_job",scope:"video.provider_job",agent:"video_producer"};
    const approvalEnvelope={...envelope,operation:"provider_job",tool:"video.provider_job"};
    approvalGrant.envelopeDigest=digestEnvelope(approvalEnvelope as never);
    createApproval.mockResolvedValue({id:10,status:"pending",expiresAt:new Date(Date.now()+300000)});
    const response=await app.inject({method:"POST",url:"/api/tasks/1/execute/approval",payload:{grant:approvalGrant,envelope:approvalEnvelope}});
    expect(response.statusCode).toBe(201);
    expect(createApproval).toHaveBeenCalledTimes(1);
    expect(updateTaskStatus).not.toHaveBeenCalled();
    expect(executeWithGovernance).not.toHaveBeenCalled();
    await app.close();
  });
});

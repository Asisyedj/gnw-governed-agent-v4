import { describe, expect, it, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { digestEnvelope } from "../../server/action-envelope.js";
import type { GovernanceRequest } from "../../server/governance.js";

const executeWithGovernance=vi.fn();
const executeGovernedTool=vi.fn();
const resolveSession=vi.fn();
const findTaskById=vi.fn();
const findUserById=vi.fn();
const findApprovalById=vi.fn();
const createApproval=vi.fn();
const insertAuditLog=vi.fn(async()=>undefined);
const updateTaskStatus=vi.fn(async()=>undefined);

vi.mock("../../server/execution.js",()=>({executeWithGovernance,executeGovernedTool}));
vi.mock("../../server/routes/auth.js",()=>({resolveSession}));
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
  });

  it("registers a reachable execute endpoint and never dispatches the tool outside governance",async()=>{
    const app=await makeApp();
    const {grant,envelope}=makeRequest();
    const response=await app.inject({method:"POST",url:"/api/tasks/1/execute",payload:{grant,envelope}});
    console.error("EXECUTE_TEST_RESPONSE",response.statusCode,response.body);
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

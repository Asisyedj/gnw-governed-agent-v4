import { beforeEach, describe, expect, it, vi } from "vitest";

const executeWithGovernance=vi.fn();
const executeGovernedTool=vi.fn();
const findApprovalById=vi.fn();
const findTaskById=vi.fn();
const findUserById=vi.fn();
const insertAuditLog=vi.fn();
const updateTaskStatus=vi.fn();
const cancelExecutor=vi.fn();
const recoverExpiredJobs=vi.fn();
const claimJob=vi.fn();
const finishJob=vi.fn();
const heartbeatJob=vi.fn();
const jobCancellationRequested=vi.fn();
const acknowledgeCancelledJob=vi.fn();
const digestQueuePayload=vi.fn();
let controllerForTest:AbortController|null=null;

vi.mock("../../server/env.js",()=>({ENV:{isProduction:false,executorUrl:"https://executor.example",executorSecret:"test-secret"}}));
vi.mock("../../server/db/index.js",()=>({db:{},pgPool:{}}));
vi.mock("../../server/execution.js",()=>({executeWithGovernance,executeGovernedTool}));
vi.mock("../../server/action-envelope.js",()=>({digestEnvelope:()=> "e".repeat(64),validateEnvelope:vi.fn()}));
vi.mock("../../server/governance.js",()=>({digestRequest:()=> "a".repeat(64)}));
vi.mock("../../server/repo.js",()=>({findApprovalById,findTaskById,findUserById,insertAuditLog,updateTaskStatus}));
vi.mock("../../server/executor-client.js",()=>({cancelExecutor}));
vi.mock("../../server/orchestration/durable-queue.js",()=>({
  acknowledgeCancelledJob,claimJob,finishJob,heartbeatJob,jobCancellationRequested,recoverExpiredJobs,
}));
vi.mock("../../server/orchestration/queue-payload.js",()=>({
  GOVERNED_EXECUTION_JOB:"governed_tool_execution",
  digestQueuePayload,
  parseQueuedExecutionPayload:(value:unknown)=>value,
}));

const TENANT=3;
const REQUEST_ID="queued-request-1";
const JOB_ID="e5ec6b6e-4e69-4f27-8fd8-06b1b7f3d36a";
const LEASE_TOKEN="d83f5b3a-a884-4842-a82f-e394a83efc90";
const payload={
  version:1 as const,taskId:31,tenantId:TENANT,actorId:41,role:"operator",requestId:REQUEST_ID,
  grant:{requestId:REQUEST_ID,tenant:String(TENANT),subject:"41",role:"operator",taskId:31,nonce:"grant-nonce",issuedAt:Date.now()-1000,expiresAt:Date.now()+60_000,envelopeDigest:"e".repeat(64),operation:"search",tool:"knowledge.search",scope:"knowledge.search"},
  envelope:{taskId:"31",tenantId:String(TENANT),actorId:"41",operation:"search",tool:"knowledge.search",parameters:{q:"test"},grantId:"grant-31",nonce:"grant-nonce",issuedAt:Date.now()},
};
const job={
  id:JOB_ID,tenant_id:TENANT,workflow_id:null,job_type:"governed_tool_execution",payload,
  payload_digest:"d".repeat(64),idempotency_key:"execution:queued-request-1",attempts:1,max_attempts:1,
  lease_token:LEASE_TOKEN,lease_expires_at:new Date(Date.now()+30_000),
};

function abortAfterOneClaim(){
  claimJob.mockImplementation(async()=>{
    if(claimJob.mock.calls.length===1) return job;
    controllerForTest?.abort("test complete");
    return null;
  });
}

beforeEach(()=>{
  vi.clearAllMocks();
  controllerForTest=null;
  digestQueuePayload.mockReturnValue("d".repeat(64));
  recoverExpiredJobs.mockResolvedValue({recovered:[],cancellationUnconfirmed:[]});
  abortAfterOneClaim();
  finishJob.mockResolvedValue("succeeded");
  heartbeatJob.mockResolvedValue(true);
  jobCancellationRequested.mockResolvedValue({leaseValid:true,cancelRequested:false});
  acknowledgeCancelledJob.mockResolvedValue(true);
  cancelExecutor.mockResolvedValue(undefined);
  findTaskById.mockResolvedValue({id:31,tenantId:TENANT,status:"pending"});
  findUserById.mockResolvedValue({id:41,tenantId:TENANT,role:"operator",isActive:true});
  findApprovalById.mockResolvedValue(undefined);
  insertAuditLog.mockResolvedValue(undefined);
  updateTaskStatus.mockResolvedValue(undefined);
  executeGovernedTool.mockResolvedValue({stdout:"ok",stderr:"",exitCode:0});
  executeWithGovernance.mockImplementation(async(_ctx:unknown,_envelope:unknown,handler:()=>Promise<unknown>)=>{
    await handler();
    return {success:true,durationMs:1};
  });
});

describe("tenant-scoped durable queue worker",()=>{
  it("revalidates a queued payload and dispatches only through GNW governance",async()=>{
    const controller=new AbortController();
    controllerForTest=controller;
    const {runTenantWorker}=await import("../../server/orchestration/worker.js");
    await runTenantWorker({pool:{} as never,tenantId:TENANT,workerId:"worker-tenant-3",signal:controller.signal});
    expect(recoverExpiredJobs).toHaveBeenCalledWith({},TENANT);
    expect(claimJob).toHaveBeenNthCalledWith(1,{},TENANT,"worker-tenant-3",30,"governed_tool_execution");
    expect(executeWithGovernance).toHaveBeenCalledTimes(1);
    expect(executeGovernedTool).toHaveBeenCalledTimes(1);
    expect(updateTaskStatus).toHaveBeenCalledWith({},31,TENANT,"running");
    expect(updateTaskStatus).toHaveBeenCalledWith({},31,TENANT,"done");
    expect(finishJob).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({jobId:JOB_ID,success:true}));
  });

  it("fails closed before execution if the durable payload digest does not match",async()=>{
    const controller=new AbortController();
    controllerForTest=controller;
    digestQueuePayload.mockReturnValue("f".repeat(64));
    const {runTenantWorker}=await import("../../server/orchestration/worker.js");
    await runTenantWorker({pool:{} as never,tenantId:TENANT,workerId:"worker-tenant-3",signal:controller.signal});
    expect(executeWithGovernance).not.toHaveBeenCalled();
    expect(executeGovernedTool).not.toHaveBeenCalled();
    expect(finishJob).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({jobId:JOB_ID,success:false,errorCode:"QUEUE_PAYLOAD_DIGEST_MISMATCH"}));
  });

  it("acknowledges cancellation only after the executor cancellation handshake succeeds",async()=>{
    const controller=new AbortController();
    controllerForTest=controller;
    jobCancellationRequested.mockResolvedValueOnce({leaseValid:true,cancelRequested:true});
    const {runTenantWorker}=await import("../../server/orchestration/worker.js");
    await runTenantWorker({pool:{} as never,tenantId:TENANT,workerId:"worker-tenant-3",signal:controller.signal});
    expect(cancelExecutor).toHaveBeenCalledWith(expect.objectContaining({executorUrl:"https://executor.example"}),{
      requestId:REQUEST_ID,actionDigest:"a".repeat(64),reason:"durable cancellation requested",
    });
    expect(acknowledgeCancelledJob).toHaveBeenCalledWith({},expect.objectContaining({tenantId:TENANT,jobId:JOB_ID,workerId:"worker-tenant-3",leaseToken:LEASE_TOKEN}));
    expect(updateTaskStatus).toHaveBeenCalledWith({},31,TENANT,"cancelled","cancelled_by_request");
    expect(executeWithGovernance).not.toHaveBeenCalled();
  });
});

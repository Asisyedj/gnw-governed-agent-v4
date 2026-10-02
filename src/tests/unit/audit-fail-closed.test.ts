import { describe, expect, it, vi } from "vitest";

const insertAuditLog=vi.fn(async()=>{ throw new Error("audit-db-down"); });
const setInterlock=vi.fn(async()=>undefined);

vi.mock("../../server/repo.js",()=>({insertAuditLog,setInterlock}));

describe("audit fail-closed invariant",()=>{
  it("trips the circuit when required audit persistence fails",async()=>{
    const { audit }=await import("../../server/audit.js");
    await expect(audit({} as never,{
      eventType:"tool.invoke",
      tenantId:1,
      actorId:7,
      taskId:9,
      resourceType:"tool",
      resourceId:"knowledge.search",
      outcome:"success"
    },{required:true})).rejects.toThrow("audit-db-down");
    expect(setInterlock).toHaveBeenCalledWith({}, {circuitOpen:true}, 7);
  });
});

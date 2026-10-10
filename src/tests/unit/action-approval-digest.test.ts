import { describe, expect, it } from "vitest";
import { actionDigest, canonicalJson } from "../../server/governance/action-approval.js";

describe("exact action approval digest",()=>{
  const base={tenantId:3,actorId:12,approverId:14,actionType:"browser.submit",toolId:"browser.submit",target:"https://allowed.example/form",payload:{amount:50,customer:"A"}};
  it("canonicalizes object key order",()=>expect(canonicalJson({b:2,a:1})).toBe(canonicalJson({a:1,b:2})));
  it("is stable for equivalent payloads",()=>expect(actionDigest(base)).toBe(actionDigest({...base,payload:{customer:"A",amount:50}})));
  it("binds tenant, actor, target and payload",()=>{
    const d=actionDigest(base);
    expect(actionDigest({...base,tenantId:4})).not.toBe(d);
    expect(actionDigest({...base,actorId:13})).not.toBe(d);
    expect(actionDigest({...base,target:"https://allowed.example/other"})).not.toBe(d);
    expect(actionDigest({...base,payload:{amount:51,customer:"A"}})).not.toBe(d);
  });
});

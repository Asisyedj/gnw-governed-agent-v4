import {describe,expect,it} from "vitest";
import {assertCapability,canMakeFinalDecision,GOVERNANCE_PIPELINE,ROLE_CAPABILITIES} from "../../server/governance-contract.js";

describe("GNW governance contract",()=>{
  it("preserves the architecture role order",()=>{expect(GOVERNANCE_PIPELINE[0]).toBe("human_principal");expect(GOVERNANCE_PIPELINE.at(-1)).toBe("final_arbiter");});
  it("denies specialist escalation",()=>{expect(()=>assertCapability("specialist_worker","final_decision")).toThrow("permission_denied");expect(()=>assertCapability("red_team","write" as never)).toThrow("permission_denied");});
  it("allows final decisions only to human principal or final arbiter",()=>{expect(canMakeFinalDecision("final_arbiter")).toBe(true);expect(canMakeFinalDecision("human_principal")).toBe(true);expect(canMakeFinalDecision("justice_reviewer")).toBe(false);});
  it("keeps external side effects out of every non-human role",()=>{for(const role of GOVERNANCE_PIPELINE.slice(1)) expect(ROLE_CAPABILITIES[role]).not.toContain("external_side_effect");});
});
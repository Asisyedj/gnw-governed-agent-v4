import {describe,expect,it,vi} from "vitest";
import {runGovernedPipeline} from "../../server/agent-pipeline.js";
import {JUSTICE_DIMENSIONS} from "../../server/justice-framework.js";
import type {EvidenceRecord} from "../../server/evidence-engine.js";

const evidence:EvidenceRecord[]=[1,2].map((n)=>({evidenceId:"E"+n,claimId:"C1",sourceId:"S"+n,sourceFamily:"F"+n,evidenceType:"implementation",statement:"supported",provenance:{locator:"https://example.test",retrievedAt:"2026-10-04T00:00:00Z",contentDigest:"a".repeat(64)},derivedFrom:[],status:"accepted"}));
const justice=()=>({findings:JUSTICE_DIMENSIONS.map(d=>({dimension:d,status:"pass" as const,evidenceRefs:["E1"],rationale:"ok"})),complete:true,failures:[] as never[]});
const workers=()=>({
  research:async()=>evidence,
  evidenceAudit:async()=>({status:"supported" as const,independentEvidence:evidence,derivativeEvidence:[],flags:[]}),
  specialist:async()=>({finding:"ok"}),
  redTeam:async()=>({status:"pass" as const,findings:[]}),
  biasAudit:async()=>({status:"pass" as const,findings:[]}),
  justiceReview:async()=>justice(),
  finalArbiter:async()=>({status:"SUPPORTED" as const,findings:["supported"],evidenceRefs:["E1","E2"],justiceReview:justice(),uncertainties:[],corrections:[],auditId:"AUDIT-1"}),
});

describe("GNW governed agent pipeline",()=>{
  it("runs every mandatory gate before final arbiter",async()=>{const r=await runGovernedPipeline(workers());expect(r.release).toBe("pass");expect(r.gates.map(g=>g.gate)).toEqual(["research","evidence_audit","specialist_analysis","red_team","bias_audit","justice_review","final_arbiter"]);});
  it("holds when evidence is unknown",async()=>{const w={...workers(),evidenceAudit:async()=>({status:"unknown" as const,independentEvidence:[],derivativeEvidence:[],flags:[]}),finalArbiter:vi.fn()};const r=await runGovernedPipeline(w);expect(r.release).toBe("hold");expect(r.gates.at(-1)?.gate).toBe("evidence_audit");expect(w.finalArbiter).not.toHaveBeenCalled();});
  it("holds when red team fails",async()=>{const w={...workers(),redTeam:async()=>({status:"fail" as const,findings:["bypass"]}),finalArbiter:vi.fn()};const r=await runGovernedPipeline(w);expect(r.release).toBe("hold");expect(r.gates.at(-1)?.gate).toBe("red_team");expect(w.finalArbiter).not.toHaveBeenCalled();});
});
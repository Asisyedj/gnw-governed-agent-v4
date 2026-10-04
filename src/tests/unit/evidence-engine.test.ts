import {describe,expect,it} from "vitest";
import {assessEvidence,isIndependentWitness,unknownWhenInsufficient,type EvidenceRecord} from "../../server/evidence-engine.js";

const e=(id:string,family:string,derivedFrom:readonly string[]=[],type:EvidenceRecord["evidenceType"]="implementation"):EvidenceRecord=>({evidenceId:id,claimId:"C1",sourceId:id,sourceFamily:family,evidenceType:type,statement:"claim evidence",provenance:{locator:"https://example.test/"+id,retrievedAt:"2026-10-04T00:00:00Z",contentDigest:id.repeat(64).slice(0,64)},derivedFrom,status:"accepted"});

describe("GNW evidence engine",()=>{
  it("treats two independent source families as support",()=>{const a=assessEvidence([e("a","A"),e("b","B")]);expect(a.status).toBe("supported");expect(a.independentEvidence).toHaveLength(2);});
  it("does not count derivative reports as independent witnesses",()=>{const d=e("d","A",["a"]);expect(isIndependentWitness(d)).toBe(false);const a=assessEvidence([e("a","A"),d]);expect(a.independentEvidence).toHaveLength(1);expect(a.derivativeEvidence).toHaveLength(1);});
  it("flags normative text without implementation proof",()=>{const a=assessEvidence([e("p","Policy",[],"principle")]);expect(a.flags).toContain("normative_text_is_not_implementation_proof");});
  it("allows unknown when evidence is insufficient",()=>{const a=assessEvidence([e("a","A")]);expect(unknownWhenInsufficient(a).status).toBe("unknown");});
});
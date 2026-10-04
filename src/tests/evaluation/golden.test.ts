import {describe,expect,it} from "vitest";
import {assessEvidence,unknownWhenInsufficient,type EvidenceRecord} from "../../server/evidence-engine.js";

const make=(family:string,type:EvidenceRecord["evidenceType"]="implementation"):EvidenceRecord=>({evidenceId:family+type,claimId:"C1",sourceId:family,sourceFamily:family,evidenceType:type,statement:"test",provenance:{locator:"https://example.test",retrievedAt:"2026-10-04T00:00:00Z",contentDigest:"b".repeat(64)},derivedFrom:[],status:"accepted"});

const golden=[
  {name:"supported",e:[make("A"),make("B")],expect:"supported"},
  {name:"single-source",e:[make("A")],expect:"unknown"},
  {name:"normative-only",e:[make("A","principle"),make("B","principle")],expect:"mixed"},
  {name:"implementation-supported",e:[make("A","principle"),make("A","implementation"),make("B","implementation")],expect:"supported"},
];
describe("GNW golden governance evaluation",()=>{
  for(const c of golden) it(c.name,()=>{const assessed=unknownWhenInsufficient(assessEvidence(c.e),2);expect(assessed.status).toBe(c.expect);});
});
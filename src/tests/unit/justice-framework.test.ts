import {describe,expect,it} from "vitest";
import {assertJusticeReviewComplete,buildJusticeReview,JUSTICE_DIMENSIONS,type JusticeFinding} from "../../server/justice-framework.js";

const findings:JusticeFinding[]=JUSTICE_DIMENSIONS.map((dimension)=>({dimension,status:"pass",evidenceRefs:["E1"],rationale:"reviewed"}));

describe("GNW justice framework",()=>{
  it("requires all six justice dimensions",()=>{const r=buildJusticeReview(findings);expect(r.complete).toBe(true);expect(r.failures).toHaveLength(0);});
  it("fails closed on incomplete review",()=>{const r=buildJusticeReview(findings.slice(0,5));expect(r.complete).toBe(false);expect(()=>assertJusticeReviewComplete(r)).toThrow("justice_review_incomplete");});
  it("blocks finalization when any dimension fails",()=>{const r=buildJusticeReview(findings.map((f,i)=>i===2?{...f,status:"fail" as const}:f));expect(()=>assertJusticeReviewComplete(r)).toThrow("justice_review_failed");});
  it("does not treat resilience as a justice dimension",()=>{expect((JUSTICE_DIMENSIONS as readonly string[]).includes("resilience")).toBe(false);});
});
import {describe,expect,it} from "vitest";
import {ADVERSARIAL_CASES,classifyAdversarialInput} from "../../server/adversarial.js";
import {evaluateComparatorSymmetry} from "../../server/bias-evaluator.js";

describe("GNW adversarial governance suite",()=>{
  it("classifies the mandatory attack corpus",()=>{for(const c of ADVERSARIAL_CASES) expect(classifyAdversarialInput(c).length).toBeGreaterThan(0);});
  it("detects comparator burden asymmetry",()=>{const r=evaluateComparatorSymmetry({subjectId:"A",independentSources:2,burdenOfProof:2,evidenceRefs:["E1","E2"]},{subjectId:"B",independentSources:1,burdenOfProof:2,evidenceRefs:["E3"]});expect(r.status).toBe("fail");});
  it("passes symmetric comparator evidence",()=>{const r=evaluateComparatorSymmetry({subjectId:"A",independentSources:2,burdenOfProof:2,evidenceRefs:["E1","E2"]},{subjectId:"B",independentSources:2,burdenOfProof:2,evidenceRefs:["E3","E4"]});expect(r.status).toBe("pass");});
});
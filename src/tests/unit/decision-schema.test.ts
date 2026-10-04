import {describe,expect,it} from "vitest";
import {validateFinalDecision} from "../../server/decision-schema.js";
import {JUSTICE_DIMENSIONS} from "../../server/justice-framework.js";

describe("GNW final decision contract",()=>{
  it("accepts only the four governed decision states",()=>{for(const status of ["SUPPORTED","UNSUPPORTED","MIXED","UNKNOWN"]){const d=validateFinalDecision({status,findings:[],evidenceRefs:["E1"],justiceReview:{dimensions:JUSTICE_DIMENSIONS},uncertainties:[],corrections:[],auditId:"A1"});expect(d.status).toBe(status);}});
  it("rejects an ungoverned decision value",()=>{expect(()=>validateFinalDecision({status:"APPROVE",findings:[],evidenceRefs:[],justiceReview:{},uncertainties:[],corrections:[],auditId:"A1"})).toThrow();});
  it("requires an audit identifier",()=>{expect(()=>validateFinalDecision({status:"UNKNOWN",findings:[],evidenceRefs:[],justiceReview:{},uncertainties:[],corrections:[]})).toThrow();});
});
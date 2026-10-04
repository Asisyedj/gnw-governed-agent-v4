import { assertCapability, type GovernanceRole } from "./governance-contract.js";
import type { EvidenceAssessment, EvidenceRecord } from "./evidence-engine.js";
import type { JusticeReview } from "./justice-framework.js";
import { validateFinalDecision, type FinalDecision } from "./decision-schema.js";

export type Gate="research"|"evidence_audit"|"specialist_analysis"|"red_team"|"bias_audit"|"justice_review"|"final_arbiter";
export type GateResult={gate:Gate;status:"pass"|"hold";reason:string};
export type PipelineWorkers={
  research:()=>Promise<EvidenceRecord[]>;
  evidenceAudit:(evidence:EvidenceRecord[])=>Promise<EvidenceAssessment>;
  specialist:(evidence:EvidenceRecord[])=>Promise<unknown>;
  redTeam:(evidence:EvidenceRecord[],analysis:unknown)=>Promise<{status:"pass"|"fail";findings:string[]}>;
  biasAudit:(evidence:EvidenceRecord[],analysis:unknown)=>Promise<{status:"pass"|"fail";findings:string[]}>;
  justiceReview:(evidence:EvidenceRecord[],analysis:unknown)=>Promise<JusticeReview>;
  finalArbiter:(evidence:EvidenceRecord[],analysis:unknown,review:JusticeReview)=>Promise<FinalDecision>;
};
export type PipelineResult={release:"pass"|"hold";gates:GateResult[];evidence:EvidenceRecord[];decision?:FinalDecision};
const use=(role:GovernanceRole,cap:Parameters<typeof assertCapability>[1])=>assertCapability(role,cap);
async function invoke<T>(fn:()=>Promise<T>):Promise<{ok:true;value:T}|{ok:false;error:string}>{try{return {ok:true,value:await fn()};}catch(error){return {ok:false,error:error instanceof Error?error.message:"worker_failure"};}}
const hold=(gates:GateResult[],gate:Gate,reason:string,evidence:EvidenceRecord[]):PipelineResult=>({release:"hold",gates:[...gates,{gate,status:"hold",reason}],evidence});

export async function runGovernedPipeline(workers:PipelineWorkers):Promise<PipelineResult>{
  const gates:GateResult[]=[];
  use("central_governor","route"); use("research_worker","append_evidence");
  const research=await invoke(workers.research); if(!research.ok)return hold(gates,"research",research.error,[]);
  const evidence=research.value; gates.push({gate:"research",status:"pass",reason:"research_completed"});
  use("evidence_auditor","provenance"); const audited=await invoke(()=>workers.evidenceAudit(evidence));
  if(!audited.ok)return hold(gates,"evidence_audit",audited.error,evidence);
  if(audited.value.status==="unknown")return hold(gates,"evidence_audit","insufficient_independent_evidence",evidence);
  gates.push({gate:"evidence_audit",status:"pass",reason:audited.value.status});
  use("specialist_worker","analyze"); const specialist=await invoke(()=>workers.specialist(evidence));
  if(!specialist.ok)return hold(gates,"specialist_analysis",specialist.error,evidence);
  const analysis=specialist.value; gates.push({gate:"specialist_analysis",status:"pass",reason:"specialist_completed"});
  use("red_team","challenge"); const red=await invoke(()=>workers.redTeam(evidence,analysis));
  if(!red.ok)return hold(gates,"red_team",red.error,evidence);
  if(red.value.status!=="pass")return hold(gates,"red_team",red.value.findings.join(";")||"red_team_failed",evidence);
  gates.push({gate:"red_team",status:"pass",reason:"no_release_blocker"});
  use("bias_auditor","challenge"); const bias=await invoke(()=>workers.biasAudit(evidence,analysis));
  if(!bias.ok)return hold(gates,"bias_audit",bias.error,evidence);
  if(bias.value.status!=="pass")return hold(gates,"bias_audit",bias.value.findings.join(";")||"bias_audit_failed",evidence);
  gates.push({gate:"bias_audit",status:"pass",reason:"no_release_blocker"});
  use("justice_reviewer","review"); const justice=await invoke(()=>workers.justiceReview(evidence,analysis));
  if(!justice.ok)return hold(gates,"justice_review",justice.error,evidence);
  if(!justice.value.complete||justice.value.failures.length)return hold(gates,"justice_review","justice_review_failed",evidence);
  gates.push({gate:"justice_review",status:"pass",reason:"six_dimensions_reviewed"});
  use("final_arbiter","final_decision"); const final=await invoke(()=>workers.finalArbiter(evidence,analysis,justice.value));
  if(!final.ok)return hold(gates,"final_arbiter",final.error,evidence);
  let decision:FinalDecision; try{decision=validateFinalDecision(final.value);}catch(error){return hold(gates,"final_arbiter",error instanceof Error?error.message:"invalid_final_decision",evidence);}
  gates.push({gate:"final_arbiter",status:"pass",reason:"structured_decision_returned"});
  return {release:"pass",gates,evidence,decision};
}
export type ComparatorEvidence={subjectId:string;independentSources:number;burdenOfProof:number;evidenceRefs:readonly string[]};
export type BiasAuditResult={status:"pass"|"fail";findings:string[]};
export function evaluateComparatorSymmetry(left:ComparatorEvidence,right:ComparatorEvidence):BiasAuditResult{
  const findings:string[]=[];
  if(left.independentSources!==right.independentSources) findings.push("independent_evidence_threshold_asymmetry");
  if(left.burdenOfProof!==right.burdenOfProof) findings.push("burden_of_proof_asymmetry");
  if(left.evidenceRefs.length!==right.evidenceRefs.length) findings.push("evidence_reference_count_asymmetry");
  return {status:findings.length?"fail":"pass",findings};
}
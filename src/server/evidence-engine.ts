import { createHash } from "node:crypto";

export type EvidenceType = "context"|"principle"|"policy"|"implementation"|"experience"|"distribution"|"outcome"|"correction";
export type EvidenceStatus = "accepted"|"challenged"|"rejected"|"unknown";
export type EvidenceRecord = {
  evidenceId:string; claimId:string; sourceId:string; sourceFamily:string; evidenceType:EvidenceType; statement:string;
  provenance:{locator:string; retrievedAt:string; contentDigest:string}; derivedFrom:readonly string[]; status:EvidenceStatus;
};
export type EvidenceAssessment = { status:"supported"|"mixed"|"unknown"; independentEvidence:EvidenceRecord[]; derivativeEvidence:EvidenceRecord[]; flags:string[] };
export function fingerprintEvidence(e:Pick<EvidenceRecord,"claimId"|"sourceFamily"|"statement">):string {
  return createHash("sha256").update("claim:"+e.claimId+"|family:"+e.sourceFamily+"|statement:"+e.statement.trim()).digest("hex");
}
export function assessEvidence(records:readonly EvidenceRecord[]):EvidenceAssessment {
  const derivativeEvidence=records.filter(e=>e.derivedFrom.length>0);
  const independentEvidence=records.filter(e=>e.derivedFrom.length===0);
  const flags:string[]=[];
  const hasImplementation = (claimId:string) => records.some(x=>x.claimId===claimId && x.evidenceType==="implementation");
  if(records.some(e=>e.evidenceType==="principle" && !hasImplementation(e.claimId))) flags.push("normative_text_is_not_implementation_proof");
  const claims=new Map<string,Set<string>>();
  for(const e of independentEvidence){ const families=claims.get(e.claimId)??new Set<string>(); families.add(e.sourceFamily); claims.set(e.claimId,families); }
  const distinctFamilyClaims=[...claims.values()].filter(x=>x.size>=2).length;
  const normativeOnly=flags.includes("normative_text_is_not_implementation_proof");
  const status=independentEvidence.length===0?"unknown":normativeOnly?"mixed":distinctFamilyClaims>0?"supported":"mixed";
  return {status,independentEvidence:[...independentEvidence],derivativeEvidence:[...derivativeEvidence],flags};
}
export function isIndependentWitness(e:EvidenceRecord):boolean{return e.derivedFrom.length===0;}
export function unknownWhenInsufficient(a:EvidenceAssessment,min=2):EvidenceAssessment{
  return a.independentEvidence.length<min?{...a,status:"unknown"}:a;
}
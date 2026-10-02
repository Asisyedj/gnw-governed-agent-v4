import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const fail=[];
const read=p=>readFileSync(p,"utf8");
const sha=s=>createHash("sha256").update(s).digest("hex");

let applicability, matrix;
try { applicability=JSON.parse(read("compliance/applicability.json")); } catch { fail.push("applicability:invalid-json"); }
try { matrix=JSON.parse(read("compliance/control-matrix.json")); } catch { fail.push("matrix:invalid-json"); }

if(applicability){
  if(applicability.schema!=="GNW.PK.Applicability.v1") fail.push("applicability:schema");
  const d=applicability.determinations??{};
  for(const key of ["PPRA_2026","PISF_2026","NCERT_AUDIT","SBP_TECH_GOVERNANCE","SBP_OUTSOURCING","SBP_CLOUD","PSS_CRYPTO","CII_PROTECTION"]){
    if(!d[key]?.status) fail.push("applicability:missing:"+key);
  }
  if(applicability.releasePolicy?.unknownOrPendingApplicableDeterminationsBlock!==true) fail.push("applicability:must-block-unknown");
  if(applicability.releasePolicy?.realHardwareTeeRequiredForProduction!==true) fail.push("applicability:real-tee-required");
}
if(matrix){
  if(matrix.schema!=="GNW.PK.ControlMatrix.v1") fail.push("matrix:schema");
  const ids=new Set();
  for(const c of matrix.controls??[]){
    if(!c.id||ids.has(c.id)) fail.push("matrix:duplicate-or-missing-id:"+String(c.id));
    ids.add(c.id);
    if(!c.regime||!c.title||!Array.isArray(c.requiredWhen)||!c.automation?.length||!c.evidence||c.blocking!==true||!/^https:\/\//.test(c.source??"")) fail.push("matrix:incomplete:"+String(c.id));
  }
}
if(fail.length){
  console.error("GNW compliance matrix: DENY");
  for(const x of fail) console.error(" - "+x);
  process.exit(1);
}
const blockingDeterminations=Object.entries(applicability.determinations??{})
  .filter(([,v])=>["LEGAL_CLASSIFICATION_REQUIRED","UNDETERMINED","PENDING"].includes(v.status))
  .map(([k,v])=>({key:k,status:v.status,basis:v.basis??""}));
console.log(JSON.stringify({
  status:"PASS",
  structuralValidation:"PASS",
  releaseBlockers:blockingDeterminations,
  applicabilityDigest:sha(read("compliance/applicability.json")),
  controlMatrixDigest:sha(read("compliance/control-matrix.json")),
  controlCount:matrix.controls.length
},null,2));

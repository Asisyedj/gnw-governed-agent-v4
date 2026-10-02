import { readFileSync } from "node:fs";
import { createHash, verify as cryptoVerify } from "node:crypto";

const fail=[];
const read=p=>readFileSync(p,"utf8");
const shaBuf=b=>createHash("sha256").update(b).digest("hex");
const sha=s=>shaBuf(Buffer.from(s));
const hex=/^[0-9a-f]{64}$/i;

const evidenceRaw=process.env.GNW_RELEASE_EVIDENCE_JSON;
const sealPublicKey=process.env.GNW_RELEASE_SEAL_PUBLIC_KEY_PEM;
const teePublicKey=process.env.GNW_TEE_ATTESTATION_PUBLIC_KEY_PEM;
const expectedTeeIssuer=process.env.GNW_TEE_ATTESTATION_ISSUER;
const expectedTeeMeasurement=process.env.GNW_TEE_ATTESTATION_MEASUREMENT?.toLowerCase();
const teeMaxAgeMs=Number(process.env.GNW_TEE_ATTESTATION_MAX_AGE_MS??120000);
if(!evidenceRaw) fail.push("release-evidence-secret-missing");
if(!sealPublicKey) fail.push("release-seal-public-key-missing");
if(!teePublicKey) fail.push("tee-attestation-public-key-missing");
if(!expectedTeeIssuer) fail.push("tee-attestation-issuer-missing");
if(!hex.test(expectedTeeMeasurement??"")) fail.push("tee-attestation-measurement-missing");
if(!Number.isFinite(teeMaxAgeMs)||teeMaxAgeMs<=0) fail.push("tee-attestation-max-age-invalid");

let evidence;
try { evidence=JSON.parse(evidenceRaw??"{}"); } catch { fail.push("release-evidence-invalid-json"); }

const applicabilityRaw=read("compliance/applicability.json");
const matrixRaw=read("compliance/control-matrix.json");
const appDigest=sha(applicabilityRaw);
const matrixDigest=sha(matrixRaw);

if(evidence){
  if(evidence.schema!=="GNW.ProductionReleaseEvidence.v1") fail.push("schema");
  const expectedSha=(process.env.GITHUB_SHA??"").toLowerCase();
  const expectedTag=process.env.GITHUB_REF_NAME??"";
  if(!/^[0-9a-f]{40}$/.test(evidence.gitCommitSha??"")||evidence.gitCommitSha.toLowerCase()!==expectedSha) fail.push("git-commit-binding");
  if(!evidence.releaseTag||evidence.releaseTag!==expectedTag) fail.push("release-tag-binding");
  if(evidence.applicabilityDigest!==appDigest) fail.push("applicability-digest");
  if(evidence.controlMatrixDigest!==matrixDigest) fail.push("control-matrix-digest");
  const artifactDigest=sha(read("dist/SHA256SUMS.txt"));
  if(evidence.artifactManifestSha256!==artifactDigest) fail.push("artifact-manifest-digest");

  const tee=evidence.tee;
  if(!tee||tee.mode!=="REAL_HARDWARE") fail.push("tee:not-real-hardware");
  if(tee){
    const now=Date.now();
    if(tee.issuer!==expectedTeeIssuer) fail.push("tee:issuer");
    if(String(tee.measurement??"").toLowerCase()!==expectedTeeMeasurement) fail.push("tee:measurement");
    if(!hex.test(tee.measurement??"")||!/^[0-9a-f]{32,128}$/i.test(tee.nonce??"")) fail.push("tee:format");
    if(!Number.isInteger(tee.issuedAt)||!Number.isInteger(tee.expiresAt)||now<tee.issuedAt||now>=tee.expiresAt||tee.expiresAt<=tee.issuedAt) fail.push("tee:freshness");
    if(Number.isFinite(teeMaxAgeMs)&&now-tee.issuedAt>teeMaxAgeMs) fail.push("tee:age");
    const payload=`GNW-TEE-ATTESTATION-V1|${tee.issuer}|${tee.measurement}|${tee.nonce}|${tee.issuedAt}|${tee.expiresAt}`;
    try{
      if(!cryptoVerify(null,Buffer.from(payload),teePublicKey,Buffer.from(tee.signature??"","hex"))) fail.push("tee:signature");
    }catch{ fail.push("tee:signature-invalid"); }
    const expectedAction=sha(`GNW-TEE-RELEASE-BINDING-V1|${evidence.gitCommitSha}|${evidence.releaseTag}|${evidence.artifactManifestSha256}`);
    if(tee.actionDigest!==expectedAction) fail.push("tee:release-binding");
  }

  let required=[];
  try{
    const app=JSON.parse(applicabilityRaw);
    const m=JSON.parse(matrixRaw);
    for(const [key,value] of Object.entries(app.determinations??{})){
      if(["LEGAL_CLASSIFICATION_REQUIRED","UNDETERMINED","PENDING"].includes(value.status)){
        fail.push("applicability-blocked:"+key+":"+value.status);
      }
    }
    for(const c of m.controls){
      if(c.requiredWhen.includes("always")) required.push(c.id);
      for(const token of c.requiredWhen){
        if(token!=="always"&&app.determinations?.[token]?.status==="APPLICABLE") required.push(c.id);
      }
    }
    required=[...new Set(required)];
    for(const [k,v] of Object.entries(app.determinations??{})){
      if(["APPLICABLE"].includes(v.status)) continue;
      if(m.controls.some(c=>c.requiredWhen.includes(k))) continue;
      if(v.status==="LEGAL_CLASSIFICATION_REQUIRED") fail.push("applicability:"+k+":required-determination");
    }
  }catch{ fail.push("control-matrix:parse"); }

  const rows=new Map((evidence.regulatoryEvidence??[]).map(x=>[x.controlId,x]));
  for(const id of required){
    const row=rows.get(id);
    if(!row||row.status!=="PASS"||!hex.test(row.evidenceSha256??"")||!row.reference) fail.push("regulatory-evidence:"+id);
  }

  const ia=evidence.independentAudit;
  if(!ia||ia.required!==true||ia.status!=="PASS"||!hex.test(ia.reportSha256??"")||(ia.blockingFindings??1)!==0) fail.push("independent-audit");
  if(!Array.isArray(evidence.approvals)||evidence.approvals.length<2) fail.push("approvals:two-required");
  const approvalIds=(evidence.approvals??[]).map(x=>String(x.approverId??"")).filter(Boolean);
  if(new Set(approvalIds).size<2) fail.push("approvals:distinct-approvers-required");

  const sealInput={
    schema:evidence.schema,
    policyVersion:evidence.policyVersion,
    gitCommitSha:evidence.gitCommitSha,
    releaseTag:evidence.releaseTag,
    applicabilityDigest:evidence.applicabilityDigest,
    controlMatrixDigest:evidence.controlMatrixDigest,
    artifactManifestSha256:evidence.artifactManifestSha256,
    tee:evidence.tee,
    regulatoryEvidence:evidence.regulatoryEvidence,
    independentAudit:evidence.independentAudit,
    approvals:evidence.approvals
  };
  const sealPayload=`GNW-PRODUCTION-RELEASE-SEAL-V1|${JSON.stringify(sealInput)}`;
  try{
    if(evidence.seal?.algorithm!=="Ed25519") fail.push("seal:algorithm");
    if(!cryptoVerify(null,Buffer.from(sealPayload),sealPublicKey,Buffer.from(evidence.seal?.signature??"","hex"))) fail.push("seal:signature");
  }catch{ fail.push("seal:signature-invalid"); }
}

if(fail.length){
  console.error("GNW production release evidence: DENY");
  for(const x of fail) console.error(" - "+x);
  process.exit(1);
}
console.log(JSON.stringify({
  status:"PASS",
  gitCommitSha:evidence.gitCommitSha,
  releaseTag:evidence.releaseTag,
  teeMode:evidence.tee.mode,
  regulatoryEvidenceCount:evidence.regulatoryEvidence.length,
  independentAudit:evidence.independentAudit.status,
  releaseSeal:"Ed25519/VALID"
},null,2));

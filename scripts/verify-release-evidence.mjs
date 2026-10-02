import { readFileSync } from "node:fs";
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";

const fail=[];
const read=p=>readFileSync(p,"utf8");
const sha=s=>createHash("sha256").update(s).digest("hex");
const hex64=/^[0-9a-f]{64}$/i, hexNonce=/^[0-9a-f]{32,128}$/i, sha40=/^[0-9a-f]{40}$/i;
const env=process.env;
const evidenceRaw=env.GNW_RELEASE_EVIDENCE_JSON;
const sealPublicKey=env.GNW_RELEASE_SEAL_PUBLIC_KEY_PEM;
const teePublicKey=env.GNW_TEE_ATTESTATION_PUBLIC_KEY_PEM;
const expectedIssuer=env.GNW_TEE_ATTESTATION_ISSUER;
const expectedMeasurement=(env.GNW_TEE_ATTESTATION_MEASUREMENT??"").toLowerCase();
const maxAgeMs=Number(env.GNW_TEE_ATTESTATION_MAX_AGE_MS??120000);
if(!evidenceRaw)fail.push("release-evidence-secret-missing");
if(!sealPublicKey)fail.push("release-seal-public-key-missing");
if(!teePublicKey)fail.push("tee-attestation-public-key-missing");
if(!expectedIssuer)fail.push("tee-attestation-issuer-missing");
if(!hex64.test(expectedMeasurement))fail.push("tee-attestation-measurement-missing");
if(!Number.isFinite(maxAgeMs)||maxAgeMs<=0)fail.push("tee-attestation-max-age-invalid");

let evidence;
try{evidence=JSON.parse(evidenceRaw??"{}");}catch{fail.push("release-evidence-invalid-json");}
const appRaw=read("compliance/applicability.json"),matrixRaw=read("compliance/control-matrix.json");
const appDigest=sha(appRaw),matrixDigest=sha(matrixRaw);

function verifyTee(e){
  if(!e||e.mode!=="REAL_HARDWARE"){fail.push("tee:not-real-hardware");return;}
  if(e.issuer!==expectedIssuer)fail.push("tee:issuer");
  if(String(e.measurement??"").toLowerCase()!==expectedMeasurement)fail.push("tee:measurement");
  if(!hex64.test(e.measurement??"")||!hexNonce.test(e.nonce??""))fail.push("tee:format");
  if(!Number.isInteger(e.issuedAt)||!Number.isInteger(e.expiresAt)||e.expiresAt<=e.issuedAt||Date.now()<e.issuedAt||Date.now()>=e.expiresAt||Date.now()-e.issuedAt>maxAgeMs)fail.push("tee:freshness");
  const payload=`GNW-TEE-ATTESTATION-V1|${e.issuer}|${e.measurement}|${e.nonce}|${e.issuedAt}|${e.expiresAt}`;
  try{if(!cryptoVerify(null,Buffer.from(payload),teePublicKey,Buffer.from(e.signature??"","hex")))fail.push("tee:signature");}catch{fail.push("tee:signature-invalid");}
  const expectedAction=sha(`GNW-TEE-RELEASE-BINDING-V1|${evidence.gitCommitSha}|${evidence.releaseTag}|${evidence.artifactManifestSha256}`);
  if(e.actionDigest!==expectedAction)fail.push("tee:release-binding");
}
function verifyMpc(e){
  const anchorRaw=env.GNW_MPC_TRUST_ANCHOR_JSON,evRaw=env.GNW_MPC_TRUST_ANCHOR_EVIDENCE_JSON;
  if(!anchorRaw||!evRaw){fail.push("mpc:environment-evidence-missing");return;}
  let anchor,ev;try{anchor=JSON.parse(anchorRaw);ev=JSON.parse(evRaw);}catch{fail.push("mpc:environment-json-invalid");return;}
  if(ev.subject!==evidence.gitCommitSha)fail.push("mpc:subject");
  if(String(ev.measurement??"").toLowerCase()!==String(e.measurement??"").toLowerCase())fail.push("mpc:measurement-to-tee");
  if(String(ev.measurement??"").toLowerCase()!==expectedMeasurement)fail.push("mpc:measurement");
  if(!hexNonce.test(ev.nonce??""))fail.push("mpc:nonce");
  const threshold=Number(anchor.threshold),participants=anchor.participants&&typeof anchor.participants==="object"&&!Array.isArray(anchor.participants)?anchor.participants:{};
  if(anchor.requireTee!==true)fail.push("mpc:require-tee");
  if(!Number.isInteger(threshold)||threshold<1||threshold>Object.keys(participants).length)fail.push("mpc:threshold");
  const releaseDigest=sha(`GNW-RELEASE-V1|${ev.subject}`);
  const payload=`GNW-TRUST-ANCHOR-V1|${releaseDigest}|${ev.measurement}|${ev.nonce}`;
  const seen=new Set();let valid=0;
  for(const s of Array.isArray(ev.signatures)?ev.signatures:[]){
    const id=typeof s?.participantId==="string"?s.participantId:"",sig=typeof s?.signature==="string"?s.signature:"",pem=id?participants[id]:"";
    if(!id||seen.has(id)||typeof pem!=="string"||!pem||!/^[0-9a-f]+$/i.test(sig))continue;
    try{if(cryptoVerify(null,Buffer.from(payload),createPublicKey(pem),Buffer.from(sig,"hex"))){seen.add(id);valid++;}}catch{}
  }
  if(valid<threshold)fail.push("mpc:threshold-verification");
  if(evidence.mpcTrustAnchor?.subject!==ev.subject||String(evidence.mpcTrustAnchor?.measurement??"").toLowerCase()!==String(ev.measurement??"").toLowerCase()||evidence.mpcTrustAnchor?.nonce!==ev.nonce)fail.push("mpc:evidence-binding");
}
if(evidence){
  if(evidence.schema!=="GNW.ProductionReleaseEvidence.v1")fail.push("schema");
  const expectedSha=(env.GITHUB_SHA??"").toLowerCase(),expectedTag=env.GITHUB_REF_NAME??"";
  if(!sha40.test(evidence.gitCommitSha??"")||evidence.gitCommitSha.toLowerCase()!==expectedSha)fail.push("git-commit-binding");
  if(evidence.releaseTag!==expectedTag)fail.push("release-tag-binding");
  if(evidence.applicabilityDigest!==appDigest)fail.push("applicability-digest");
  if(evidence.controlMatrixDigest!==matrixDigest)fail.push("control-matrix-digest");
  const artifactRequired=(env.GNW_RELEASE_ARTIFACT_REQUIRED??"true").toLowerCase()==="true";
  if(artifactRequired){const artifactDigest=sha(read("dist/SHA256SUMS.txt"));if(evidence.artifactManifestSha256!==artifactDigest)fail.push("artifact-manifest-digest");}
  else if(!hex64.test(evidence.artifactManifestSha256??""))fail.push("artifact-manifest-digest-metadata-missing");
  verifyTee(evidence.tee); verifyMpc(evidence.mpcTrustAnchor);
  const rows=new Map((evidence.regulatoryEvidence??[]).map(x=>[x.controlId,x]));
  const required=[];
  const app=JSON.parse(appRaw),m=JSON.parse(matrixRaw);
  for(const [key,val] of Object.entries(app.determinations??{})){
    if(["LEGAL_CLASSIFICATION_REQUIRED","UNDETERMINED","PENDING"].includes(val.status))fail.push("applicability-blocked:"+key+":"+val.status);
  }
  for(const c of m.controls){if(c.requiredWhen.includes("always"))required.push(c.id);for(const t of c.requiredWhen){if(t!=="always"&&app.determinations?.[t]?.status==="APPLICABLE")required.push(c.id);}}
  for(const id of new Set(required)){const row=rows.get(id);if(!row||row.status!=="PASS"||!hex64.test(row.evidenceSha256??"")||!row.reference)fail.push("regulatory-evidence:"+id);}
  if(!evidence.hsm||evidence.hsm.status!=="PASS"||!hex64.test(evidence.hsm.attestationSha256??""))fail.push("hsm:evidence");
  const ia=evidence.independentAudit;if(!ia||ia.required!==true||ia.status!=="PASS"||!hex64.test(ia.reportSha256??"")||(ia.blockingFindings??1)!==0)fail.push("independent-audit");
  const ids=(evidence.approvals??[]).map(x=>String(x.approverId??"")).filter(Boolean);if(ids.length<2||new Set(ids).size<2)fail.push("approvals:two-distinct-required");
  const sealInput={schema:evidence.schema,policyVersion:evidence.policyVersion,gitCommitSha:evidence.gitCommitSha,releaseTag:evidence.releaseTag,applicabilityDigest:evidence.applicabilityDigest,controlMatrixDigest:evidence.controlMatrixDigest,artifactManifestSha256:evidence.artifactManifestSha256,tee:evidence.tee,mpcTrustAnchor:evidence.mpcTrustAnchor,regulatoryEvidence:evidence.regulatoryEvidence,independentAudit:evidence.independentAudit,hsm:evidence.hsm,approvals:evidence.approvals};
  const sealPayload=`GNW-PRODUCTION-RELEASE-SEAL-V1|${JSON.stringify(sealInput)}`;
  try{if(evidence.seal?.algorithm!=="Ed25519")fail.push("seal:algorithm");if(!cryptoVerify(null,Buffer.from(sealPayload),sealPublicKey,Buffer.from(evidence.seal?.signature??"","hex")))fail.push("seal:signature");}catch{fail.push("seal:signature-invalid");}
}
if(fail.length){console.error("GNW production release evidence: DENY");for(const x of fail)console.error(" - "+x);process.exit(1);}
console.log(JSON.stringify({status:"PASS",gitCommitSha:evidence.gitCommitSha,releaseTag:evidence.releaseTag,teeMode:evidence.tee.mode,regulatoryEvidenceCount:evidence.regulatoryEvidence.length,independentAudit:evidence.independentAudit.status,hsm:evidence.hsm.status,releaseSeal:"Ed25519/VALID"},null,2));

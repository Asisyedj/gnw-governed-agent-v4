import { createHash, createHmac, generateKeyPairSync, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
const fail=[];
const sha=createHash("sha256").update("abc").digest("hex");
if(sha!=="ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")fail.push("sha256-vector");
const h=createHmac("sha256","key").update("The quick brown fox jumps over the lazy dog").digest("hex");
if(h!=="f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8")fail.push("hmac-vector");
const kp=generateKeyPairSync("ed25519"),msg=Buffer.from("GNW-CRYPTO-CLOSURE-V1"),sig=sign(null,msg,kp.privateKey);
if(!verify(null,msg,kp.publicKey,sig))fail.push("ed25519-vector");
const read=p=>readFileSync(p,"utf8");

const gov=read("src/server/governance.ts"),exec=read("src/server/execution.ts"),env=read("src/server/action-envelope.ts"),att=read("src/server/attestation.ts"),ta=read("src/server/trust-anchor.ts"),client=read("src/server/executor-client.ts");
for(const [label,text,needle] of [["governance-domain",gov,"GNW-ACTION-ENVELOPE-V1"],["governance",gov,"envelopeDigest"],["execution",exec,"governance_digest_mismatch"],["envelope",env,"digestEnvelope"],["tee",att,"GNW-TEE-ATTESTATION-V1"],["trust-anchor",ta,"GNW-TRUST-ANCHOR-V1"],["executor",client,"actionDigest"],["executor-required",client,"executor_action_digest_required"]])if(!text.includes(needle))fail.push(label+"-binding-missing");
const preflight=readFileSync("scripts/preflight-production.mjs","utf8");
for(const needle of ["GNW_TEE_ATTESTATION_EVIDENCE_JSON","GNW-TEE-RELEASE-ATTESTATION-V1","GNW_MPC_TRUST_ANCHOR_EVIDENCE_JSON","GNW-RELEASE-V1"])if(!preflight.includes(needle))fail.push("release-evidence-gate-missing:"+needle);
const rk=generateKeyPairSync("ed25519");
const subject="0".repeat(40);
const measurement="a".repeat(64);
const nonce="b".repeat(32);
const issuedAt=1700000000000,expiresAt=1700000120000;
const teePayload=`GNW-TEE-RELEASE-ATTESTATION-V1|${subject}|verifier|${measurement}|${nonce}|${issuedAt}|${expiresAt}`;
if(!verify(null,Buffer.from(teePayload),rk.publicKey,sign(null,Buffer.from(teePayload),rk.privateKey)))fail.push("release-tee-ed25519-roundtrip");
const releaseDigest=createHash("sha256").update(`GNW-RELEASE-V1|${subject}`).digest("hex");
const taPayload=`GNW-TRUST-ANCHOR-V1|${releaseDigest}|${measurement}|${nonce}`;
if(!verify(null,Buffer.from(taPayload),rk.publicKey,sign(null,Buffer.from(taPayload),rk.privateKey)))fail.push("release-trust-anchor-roundtrip");

if(fail.length){console.error("GNW cryptographic closure: DENY");for(const x of fail)console.error(" - "+x);process.exit(1);}
console.log("GNW cryptographic closure: independent vector and binding checks PASS");

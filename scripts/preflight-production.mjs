import { URL } from "node:url";
import { createHash, createPrivateKey, createPublicKey, sign, verify as cryptoVerify } from "node:crypto";

const required = [
  "DATABASE_URL", "COOKIE_SECRET", "SESSION_SECRET", "EXECUTOR_URL", "EXECUTOR_SECRET",
  "GNW_REQUIRE_SIGNED_GRANTS", "GNW_GRANT_ISSUER", "GNW_GRANT_PRIVATE_KEY_PEM",
  "GNW_GRANT_PUBLIC_KEY_PEM", "GNW_LEASE_PRIVATE_KEY_PEM", "GNW_LEASE_PUBLIC_KEY_PEM", "GNW_EGRESS_ALLOW_LIST",
  "GNW_REQUIRE_TEE_ATTESTATION", "GNW_TEE_ATTESTATION_ISSUER", "GNW_TEE_ATTESTATION_PUBLIC_KEY_PEM",
  "GNW_TEE_ATTESTATION_MEASUREMENT", "GNW_TEE_ATTESTATION_EVIDENCE_JSON",
  "GNW_REQUIRE_MPC_TRUST_ANCHOR", "GNW_MPC_TRUST_ANCHOR_JSON", "GNW_MPC_TRUST_ANCHOR_EVIDENCE_JSON"
];
const failures = [];
const env = process.env;
const req = name => (env[name] ?? "").trim();

for (const name of required) {
  if (!req(name)) failures.push(name + " missing");
}

if ((env.NODE_ENV ?? "production") !== "production") failures.push("NODE_ENV must be production");
for (const name of ["COOKIE_SECRET","SESSION_SECRET","EXECUTOR_SECRET"]) {
  const value = env[name] ?? "";
  if (value && value.length < 32) failures.push(name + " must be at least 32 characters");
}
if (env.GNW_REQUIRE_SIGNED_GRANTS !== "true") failures.push("GNW_REQUIRE_SIGNED_GRANTS must be true");
if (env.GNW_REQUIRE_TEE_ATTESTATION !== "true") failures.push("GNW_REQUIRE_TEE_ATTESTATION must be true");
if (!/^[0-9a-f]{64}$/i.test(env.GNW_TEE_ATTESTATION_MEASUREMENT ?? "")) failures.push("GNW_TEE_ATTESTATION_MEASUREMENT must be 64 hex characters");
if (!env.GNW_EGRESS_ALLOW_LIST?.split(",").map(x => x.trim()).filter(Boolean).length) failures.push("GNW_EGRESS_ALLOW_LIST must contain at least one host");

for (const name of ["DATABASE_URL"]) {
  const value = env[name] ?? "";
  if (value && !/^[a-z]+:\/\//i.test(value)) failures.push(name + " must be a URL");
}
for (const name of ["EXECUTOR_URL","LLM_BASE_URL","GNW_DEEP_RESEARCH_BASE_URL","CORS_ORIGIN"]) {
  const value = env[name] ?? "";
  if (!value || value === "same-origin") continue;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") failures.push(name + " must use HTTPS");
  } catch {
    failures.push(name + " must be a valid URL");
  }
}

const databaseUrl = env.DATABASE_URL ?? "";
if (databaseUrl && !/[?&]sslmode=verify-full(?:&|$)/i.test(databaseUrl)) failures.push("DATABASE_URL must use sslmode=verify-full");
if ((env.STORAGE_DRIVER ?? "local") === "local" && env.GNW_SHARED_STORAGE_CONFIRMED !== "true") failures.push("GNW_SHARED_STORAGE_CONFIRMED must be true for local shared storage");
if (env.GNW_HOST && /example\.com$/i.test(env.GNW_HOST)) failures.push("GNW_HOST is still an example domain");

function verifyKeyPair(privateName,publicName,label){
  try{
    const priv=createPrivateKey(req(privateName)),pub=createPublicKey(req(publicName));
    const payload=Buffer.from("GNW-"+label+"-KEY-PAIR-V1");
    const signature=sign(null,payload,priv);
    if(!cryptoVerify(null,payload,pub,signature)) failures.push(label+" key pair verification failed");
  }catch{ failures.push(label+" key pair parse/verification failed"); }
}

verifyKeyPair("GNW_GRANT_PRIVATE_KEY_PEM","GNW_GRANT_PUBLIC_KEY_PEM","GRANT");
verifyKeyPair("GNW_LEASE_PRIVATE_KEY_PEM","GNW_LEASE_PUBLIC_KEY_PEM","LEASE");

function parseJson(name) {
  try { return JSON.parse(env[name] ?? ""); }
  catch { failures.push(name + " invalid JSON"); return undefined; }
}

function verifyReleaseTeeEvidence() {
  const evidence = parseJson("GNW_TEE_ATTESTATION_EVIDENCE_JSON");
  if (!evidence || typeof evidence !== "object") return;
  const subject = typeof evidence.subject === "string" ? evidence.subject : "";
  const issuer = typeof evidence.issuer === "string" ? evidence.issuer : "";
  const measurement = typeof evidence.measurement === "string" ? evidence.measurement.toLowerCase() : "";
  const nonce = typeof evidence.nonce === "string" ? evidence.nonce : "";
  const issuedAt = Number(evidence.issuedAt);
  const expiresAt = Number(evidence.expiresAt);
  const signature = typeof evidence.signature === "string" ? evidence.signature : "";
  if (subject !== (env.GITHUB_SHA ?? "")) failures.push("TEE evidence subject must equal GITHUB_SHA");
  if (issuer !== env.GNW_TEE_ATTESTATION_ISSUER) failures.push("TEE evidence issuer mismatch");
  if (measurement !== (env.GNW_TEE_ATTESTATION_MEASUREMENT ?? "").toLowerCase()) failures.push("TEE evidence measurement mismatch");
  if (!/^[0-9a-f]{64}$/i.test(measurement)) failures.push("TEE evidence measurement invalid");
  if (!/^[0-9a-f]{32,128}$/i.test(nonce)) failures.push("TEE evidence nonce invalid");
  if (!Number.isInteger(issuedAt) || !Number.isInteger(expiresAt) || expiresAt <= issuedAt) failures.push("TEE evidence validity window invalid");
  const now = Date.now();
  const maxAge = Number.parseInt(env.GNW_TEE_ATTESTATION_MAX_AGE_MS ?? "120000", 10);
  if (now < issuedAt || now >= expiresAt || now - issuedAt > maxAge) failures.push("TEE evidence expired or too old");
  if (!/^[0-9a-f]+$/i.test(signature)) failures.push("TEE evidence signature invalid");
  try {
    const key = createPublicKey(env.GNW_TEE_ATTESTATION_PUBLIC_KEY_PEM ?? "");
    const payload = `GNW-TEE-RELEASE-ATTESTATION-V1|${subject}|${issuer}|${measurement}|${nonce}|${issuedAt}|${expiresAt}`;
    if (!cryptoVerify(null, Buffer.from(payload), key, Buffer.from(signature, "hex"))) failures.push("TEE evidence signature verification failed");
  } catch { failures.push("TEE evidence public key/signature verification failed"); }
}

function verifyMpcReleaseEvidence() {
  const anchor = parseJson("GNW_MPC_TRUST_ANCHOR_JSON");
  const evidence = parseJson("GNW_MPC_TRUST_ANCHOR_EVIDENCE_JSON");
  if (!anchor || !evidence) return;
  const threshold = Number(anchor.threshold);
  const participants = anchor.participants && typeof anchor.participants === "object" && !Array.isArray(anchor.participants) ? anchor.participants : {};
  if (env.GNW_REQUIRE_MPC_TRUST_ANCHOR !== "true") failures.push("GNW_REQUIRE_MPC_TRUST_ANCHOR must be true");
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > Object.keys(participants).length) failures.push("MPC trust-anchor threshold invalid");
  if (anchor.requireTee !== true) failures.push("MPC trust-anchor requireTee must be true");
  const subject = typeof evidence.subject === "string" ? evidence.subject : "";
  const measurement = typeof evidence.measurement === "string" ? evidence.measurement.toLowerCase() : "";
  const nonce = typeof evidence.nonce === "string" ? evidence.nonce : "";
  const signatures = Array.isArray(evidence.signatures) ? evidence.signatures : [];
  if (subject !== (env.GITHUB_SHA ?? "")) failures.push("MPC evidence subject must equal GITHUB_SHA");
  if (measurement !== (env.GNW_TEE_ATTESTATION_MEASUREMENT ?? "").toLowerCase()) failures.push("MPC evidence measurement mismatch");
  if (!/^[0-9a-f]{64}$/i.test(measurement)) failures.push("MPC evidence measurement invalid");
  if (!/^[0-9a-f]{32,128}$/i.test(nonce)) failures.push("MPC evidence nonce invalid");
  const releaseDigest = createHash("sha256").update(`GNW-RELEASE-V1|${subject}`).digest("hex");
  const payload = `GNW-TRUST-ANCHOR-V1|${releaseDigest}|${measurement}|${nonce}`;
  const seen = new Set();
  let valid = 0;
  for (const entry of signatures) {
    const id = entry && typeof entry.participantId === "string" ? entry.participantId : "";
    const sig = entry && typeof entry.signature === "string" ? entry.signature : "";
    const pem = id ? participants[id] : "";
    if (!id || seen.has(id) || typeof pem !== "string" || !pem || !/^[0-9a-f]+$/i.test(sig)) continue;
    try {
      if (cryptoVerify(null, Buffer.from(payload), createPublicKey(pem), Buffer.from(sig, "hex"))) {
        seen.add(id);
        valid++;
      }
    } catch {}
  }
  if (valid < threshold) failures.push("MPC trust-anchor threshold verification failed");
}

verifyReleaseTeeEvidence();
verifyMpcReleaseEvidence();

if (failures.length) {
  console.error("GNW production environment preflight: DENY");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}
console.log("GNW production environment preflight: PASS");

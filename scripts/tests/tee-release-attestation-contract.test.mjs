import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { teeReleaseAttestationPayload } from "../lib/tee-release-attestation.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const attestation = {
  subject: "a".repeat(40),
  issuer: "contract-test-only",
  measurement: "b".repeat(64),
  nonce: "c".repeat(32),
  issuedAt: 1_800_000_000_000,
  expiresAt: 1_800_000_120_000,
};
const payload = teeReleaseAttestationPayload(attestation);
assert.equal(
  payload,
  `GNW-TEE-RELEASE-ATTESTATION-V1|${attestation.subject}|${attestation.issuer}|${attestation.measurement}|${attestation.nonce}|${attestation.issuedAt}|${attestation.expiresAt}`,
);
const signature = sign(null, Buffer.from(payload), privateKey);
assert.equal(verify(null, Buffer.from(payload), publicKey, signature), true);
assert.equal(
  verify(null, Buffer.from(teeReleaseAttestationPayload({ ...attestation, subject: "d".repeat(40) })), publicKey, signature),
  false,
);
console.log("release TEE payload contract: PASS (synthetic key test only; not hardware attestation)");

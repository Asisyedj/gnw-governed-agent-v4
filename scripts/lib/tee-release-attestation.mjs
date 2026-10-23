/**
 * One canonical release-level TEE payload shared by the preflight and final
 * release-evidence verifier. This is distinct from per-request runtime evidence.
 */
export function teeReleaseAttestationPayload({ subject, issuer, measurement, nonce, issuedAt, expiresAt }) {
  return `GNW-TEE-RELEASE-ATTESTATION-V1|${subject}|${issuer}|${measurement}|${nonce}|${issuedAt}|${expiresAt}`;
}

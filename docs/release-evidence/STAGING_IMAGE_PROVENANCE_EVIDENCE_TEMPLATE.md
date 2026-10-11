# GNW Staging, Image Security and Release Provenance Evidence Pack

**Status:** TEMPLATE ONLY — no live staging run or production release is claimed.
**Target commit:** 82849c3d16e6d09e534c4453436c87d798e33ef5
**Release decision:** HOLD / NO-GO until required evidence is populated and independently reviewed.

Do not place credentials, private keys, tokens, customer data or unredacted sensitive logs in this pack.

## 1. Staging target and authorization

- Provider/project/service/environment: PENDING
- Staging URL/hostname: PENDING
- Deployment/service/environment IDs: PENDING
- Authorized operator and approval reference: PENDING
- Confirmation staging data and secrets are isolated from production: PENDING
- Health/readiness endpoint: PENDING
- Previous known-good deployment and image digest for rollback: PENDING
- Change window and rollback owner: PENDING

Do not deploy until the target, scope, authorization and rollback target are confirmed. Target staging only.

## 2. Build identity and immutable artifact

- Repository: Asisyedj/gnw-governed-agent-v4
- Merged commit SHA: 82849c3d16e6d09e534c4453436c87d798e33ef5
- GitHub Actions run URL/ID: PENDING
- Builder/workflow identity: PENDING
- Immutable image reference and OCI digest: PENDING
- Provenance/attestation URI and digest: PENDING
- SBOM URI and SHA-256: PENDING
- Source tree and lockfile digest: PENDING

Bind all later scan, deployment, smoke-test and approval records to the same image digest. A mutable tag is not sufficient.

## 3. Live staging smoke test record

For each case, record UTC timestamp, commit, image digest, deployment ID, redacted request/response summary, result and evidence URI.

| Test | Expected result | Result | Evidence |
|---|---|---|---|
| TLS certificate/hostname | Valid chain and expected hostname | PENDING | PENDING |
| Health/readiness | Healthy and correct release identity | PENDING | PENDING |
| Core API paths | Expected status/schema; no sensitive output | PENDING | PENDING |
| Authentication/RBAC | Unauthorized actions denied | PENDING | PENDING |
| Tenant isolation | Cross-tenant access denied | PENDING | PENDING |
| PostgreSQL/RLS | Runtime role cannot bypass tenant policies | PENDING | PENDING |
| Governance/audit | Decisions recorded and tamper controls enforced | PENDING | PENDING |
| Kill switch/interlock | Restricted work stops safely | PENDING | PENDING |
| docs.write lifecycle | Write/read/digest/cleanup verified | PENDING | PENDING |
| IPv4 loopback/private SSRF | Rejected before egress | PENDING | PENDING |
| IPv4-mapped IPv6, dotted and hex | Private mapped addresses rejected | PENDING | PENDING |
| Link-local metadata address | Rejected; never contact real metadata endpoint | PENDING | PENDING |
| IPv6 ULA/link-local/multicast | Rejected | PENDING | PENDING |
| Mixed DNS answer set | Entire set rejected if any address is unsafe | PENDING | PENDING |
| Error handling/rate limits | No stack traces or secret leakage | PENDING | PENDING |

Use deterministic fixtures or an isolated controlled DNS fixture. Never target a real cloud metadata service.

## 4. Live staging rollback

- Pre-change deployment and image digest: PENDING
- New staging deployment and image digest: PENDING
- Rollback start/end timestamps (UTC): PENDING
- Rollback action and operator: PENDING
- Restored deployment and image digest: PENDING
- Post-rollback health/smoke result: PENDING
- Evidence URI/digest: PENDING
- Outcome: PENDING

A disposable CI database rollback drill does not satisfy this live staging rollback requirement.

## 5. Production container image scan

- Scanner/version and vulnerability DB timestamp: PENDING
- Exact immutable image digest scanned: PENDING
- Scan report URI and SHA-256: PENDING
- SBOM format/version, URI and SHA-256: PENDING
- Secret scan report URI and SHA-256: PENDING
- Critical findings / High findings: PENDING
- Approved exceptions, owner, rationale and expiry: PENDING
- Policy decision: PENDING

Scan the exact digest intended for release. Default policy: no unapproved Critical/High findings and no embedded secrets. Record exceptions explicitly.

## 6. Signed release provenance

- Provenance format (for example SLSA/in-toto): PENDING
- Trusted builder identity/workflow: PENDING
- Subject image digest: PENDING
- Source repository and commit SHA: PENDING
- Workflow run ID/URL: PENDING
- SBOM and scan report digests: PENDING
- Attestation URI and SHA-256: PENDING
- Signing system/issuer: PENDING
- Signature verification output: PENDING
- Verified signer identity/issuer/subject: PENDING
- Independent verifier and timestamp (UTC): PENDING

Use the configured trusted signing system (for example GitHub artifact attestations/Sigstore where supported). Independently verify the signature and subject digest. Do not fabricate signatures or claim provenance without verification.

## 7. Independent review and release decision

- Security reviewer and approval reference: PENDING
- Operations/staging operator and approval reference: PENDING
- Release approver and approval reference: PENDING
- Distinct-approver policy confirmed: PENDING
- Open Critical/High findings and exceptions: PENDING
- Final decision: HOLD / NO-GO
- Decision timestamp (UTC): PENDING
- Evidence bundle URI and SHA-256: PENDING

## 8. Evidence manifest

Create a machine-readable manifest listing each report's relative path, media type, byte size and SHA-256. Bind it to the merged commit and immutable image digest. All fields below are placeholders until verified:

- Schema: GNW.StagingReleaseEvidence.v1
- Repository: Asisyedj/gnw-governed-agent-v4
- Git commit: 82849c3d16e6d09e534c4453436c87d798e33ef5
- Image reference/digest: PENDING
- Staging environment/deployment ID: PENDING
- Smoke result and rollback result: PENDING
- Scanner/report digest and SBOM digest: PENDING
- Provenance URI/digest and signature verification: PENDING
- Approvals: PENDING
- Decision: HOLD

## 9. Exit criteria

Do not mark complete until:
1. Live staging smoke tests pass or have explicitly approved exceptions.
2. A real staging rollback to the recorded prior digest succeeds and is independently verified.
3. The exact image digest has a reviewed scan report and SBOM.
4. Signed provenance is generated and independently verified against that digest and commit.
5. Required independent approvals and final release decision are recorded.
6. The evidence bundle is hashed, access-controlled and attached to the release record.

Passing GitHub CI, container smoke tests or a disposable database rollback does not itself authorize production deployment.

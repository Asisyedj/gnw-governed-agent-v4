# GNW Continuous Security Program

## Purpose

GNW uses continuous control verification rather than treating a one-time penetration test or one CI pass as proof of ongoing security. The program follows the GNW-REP-1.0 execution method and preserves evidence for the exact source SHA.

## Continuous cadence

| Control | Cadence | Evidence | Release impact |
|---|---|---|---|
| CI typecheck/lint/unit/integration/RLS | Every push/PR | GitHub Actions | Blocking |
| Dependency + secret scan | Every push/PR | CI logs/artifacts | Blocking on high/verified findings |
| Production closure gate | Every push/PR | BuildEvidence.v3 | Blocking |
| OSSF Scorecard | Every push + weekly | SARIF | Security finding / remediation queue |
| Continuous assurance | Daily + push/PR | security-evidence artifact | Blocking |
| Red-team regression simulation | Weekly | red-team artifact | Blocking |
| Authorized staging DAST baseline | Weekly when staging target is configured | ZAP report | Blocking on configured FAIL rules |
| Authorized active DAST | Manual with protected security-testing environment | ZAP report | Blocking for release candidate when run |
| Independent manual penetration test | At least annually and after material architecture changes | signed assessment/report | Release gate for high-risk changes |
| Access review | Monthly | IAM/RBAC review record | Blocking for privileged-role drift |
| Incident/kill-switch drill | Quarterly | drill evidence | Blocking if recovery objective is missed |

OWASP Web Security Testing Guide (WSTG) is the methodology baseline for lifecycle security testing.

## Red-team simulation scope

The weekly regression suite intentionally exercises defensive failure paths: authorization bypass attempts, tenant-context mismatch, grant replay, approval replay, separation-of-duties failure, action-envelope tampering, capability-lease replay/expiry, unsafe egress, executor credential mismatch, audit-gate failure assumptions, and runtime-attestation tampering.

These tests are deterministic application-level simulations. They are not represented as a substitute for an independently scoped penetration test against an authorized staging environment.

## Strict access control

Privileged actions require explicit role, tenant, task, request, operation, scope, approval, replay nonce, budget, interlock, and capability binding. Restricted actions additionally require a valid runtime attestation when `GNW_REQUIRE_TEE_ATTESTATION=true`.

Production restricted actions fail closed if the attestation verifier configuration or evidence is missing. The attestation evidence is bound to an issuer, measurement, nonce, validity window, and signature.

## Runtime integrity / TEE

The repository now contains a generic signed runtime-attestation verification boundary. This is deliberately not described as a hardware quote verifier: actual hardware-backed trust requires a deployed confidential-computing verifier for the selected platform (for example a confidential VM/TEE with remote attestation) and a measured workload identity policy.

The deployment target must verify the workload measurement before releasing sensitive credentials or restricted data. NIST's confidential-computing guidance treats attestation as evidence that a workload's measured code/configuration matches the expected trusted state.

## Threshold / MPC roadmap

GNW should not implement ad-hoc MPC or threshold cryptography in application code. For root signing keys, emergency release authority, or high-value credential unsealing, use an independently reviewed threshold scheme or HSM/KMS integration. NIST's threshold-cryptography program describes distributing secret-key trust across multiple parties so the secret need not be reconstructed during the cryptographic operation.

Target architecture:

1. Split high-value signing/unsealing authority across independent custodians.
2. Require a configured threshold of independent approvals/cryptographic shares.
3. Never reconstruct the root secret inside GNW application memory.
4. Bind the threshold operation to release SHA, artifact digest, tenant, action digest, and attested workload identity.
5. Log the threshold decision and all participating identities as immutable evidence.
6. Rotate shares independently and rehearse recovery without exposing the reconstructed key.

This roadmap is a deployment integration, not a claim that GNW currently ships a production MPC implementation.

## Cryptographic integrity

GNW already uses SHA-256 digests, signed grants, signed capability leases, action-envelope binding, and trajectory-chain hashing. The next integrity layer is hardware-backed attestation and external key custody; hashing alone cannot make data integrity "unbreakable" and should never be described that way.

## Security scorecard

The live scorecard consists of OSSF Scorecard SARIF plus GNW's continuous-security evidence. OSSF Scorecard evaluates supply-chain and repository controls including branch protection, dangerous workflows, code review, pinned dependencies, token permissions, CI testing and SAST.

Security findings are tracked by severity and control owner. A score is a measurement of current evidence, not a guarantee of security.

## Fail-closed release conditions

A release must stop when any of these occur:

- required CI/security check is missing or failed;
- high/critical dependency or container vulnerability is unresolved under the release policy;
- required audit persistence cannot be verified;
- RLS verification fails;
- governance-to-envelope digest binding fails;
- restricted production workload has no valid attestation evidence;
- release artifact digest/provenance cannot be established;
- authorized DAST reports a configured FAIL condition;
- an independent assessment leaves an unaccepted critical finding.

## External-assessment boundary

GNW may be aligned to security frameworks, but external certification or an independent penetration-test attestation requires an appropriately scoped third-party assessment. The repository's automated controls are evidence for that assessment, not a replacement for it.

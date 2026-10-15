# GNW v4 — Repository Implementation Truth Audit

**Audit cutoff:** 15 October 2026  
**Target repository:** Asisyedj/gnw-governed-agent-v4  
**Live default branch / HEAD:** main / a5e027416232d6b8b8219724e81792a6175093fb  
**Supplied archive:** GNW-Governed-Agent-v4-2026-10-09.zip  
**Archive SHA-256:** debe353db84cc766331c0866555128af2a895b4ffff6df50404fc7fb2774cda4  
**Verdict:** **HOLD — not certified; production readiness is not established.**

## Executive finding

Live main contains a meaningful Fastify/TypeScript governed-agent control plane: authentication/session routes, tasks and execution, canonical action digests, approval checks, nonce replay prevention, budget reservations, signed capability leases, PostgreSQL Row-Level Security (RLS), safety interlocks, audit-chain verification, egress/SSRF checks, observability and release gates. These are implementation elements, not just README claims. [1]–[10]

The supplied 9 October ZIP is not a complete reproducible source repository. It has 248 ZIP entries, primarily compiled dist output plus docs, migrations, deployment/monitoring templates and workflows. It does not include root README.md, package.json, package-lock.json or the src tree. It contains drizzle/0003_apex_ledger_outbox.sql, whereas current live main has a different audit-chain sequence: 0003_audit_hash_chain.sql, 0004_audit_verifier_hardening.sql and 0005_audit_chain_v2_framing.sql. Current live production-certification documentation and workflow are also absent from the ZIP. The archive's exact originating commit and mapping to the published OCI image were not established. [1] [2] [3] [11]–[15]

Ordinary CI/security/compliance/CodeQL/Scorecard checks succeeded on the audited main SHA, and a container image was published with digest sha256:7bc63381012a60ee5709e78f8a1319b4b9cfe5741b872a7152fb6108d0de4800. Its workflow records signing and build-provenance attestation. This proves the cited build/test/publication actions, not production deployment, real-provider E2E operation or certification. [16] [17]

The separate candidate-certification run #38731098233 failed at the direct mission-runner guard because the workflow runs it before npm ci. Logs report ERR_MODULE_NOT_FOUND for package pg, and subsequent evidence gates were skipped. This is a workflow-ordering failure, not by itself proof that the mission runner is exploitable. PR #84 proposed the ordering fix, passed its inspected PR checks, but remained open/unmerged at cutoff. [18] [19]

The repository’s own PRODUCTION_CERTIFICATION.md says NOT CERTIFIED; ten live integrations and a live end-to-end mission are NOT TESTED; independent review is NOT APPROVED. That explicit decision governs the current status. [14]

## Actual purpose and execution flow

The Fastify app validates secrets, installs security headers, rate limits and cross-site/origin protections, checks global kill-switch/circuit state on mutating API requests and registers auth, task, execution, approval, interlock, audit, health, metrics and settings routes. The governed execution wrapper invokes the policy service, records required audit events, verifies/consumes a capability lease when issued, invokes a supplied handler and records its result. Governance computes a canonical action digest and applies interlock, approval, nonce and budget checks. [4]–[8]

The executor client signs request ID, timestamp and SHA-256 body digest with HMAC, requires HTTPS and an action digest in production, rejects redirects and uses timeouts. This proves the client protocol exists; it does not prove a production receiver/sandbox is deployed with OS isolation, resource limits, receiver-side replay-window enforcement, network isolation and reliable cancellation. The certification record says live end-to-end mission testing has not been done. [8] [9] [14]

## Control-by-control classification

| Area | Classification | Finding |
|---|---|---|
| Authentication / RBAC | Implemented; E2E under-tested | Roles and auth/session routes exist. Production identity, session expiry/revocation and cross-tenant negative cases still need environment-specific evidence. [4] [5] |
| Tenant RLS | Implemented for listed tables; coverage gap | Migrations enable/force RLS for users, tasks, task steps, approvals, budgets, audit logs, leases and artifacts, with same-tenant composite FKs. The RLS suite omits sessions, and migration 0001 does not enable RLS on sessions. Explicitly decide whether token-hash lookup is a deliberate global boundary and test tenant-mismatch/non-disclosure behavior. [10] [11] [12] |
| Approval / separation of duties | Implemented; under-tested | Action-digest-bound approval and independent-approver logic exist. Test expiry, changed action, concurrent review, revocation and same-actor rejection end-to-end. [6] [7] |
| Nonce / replay | Implemented; CI-tested | Unique nonce storage and one-time lease consumption fail closed. Receiver-side replay-window behavior and production multi-instance races remain unverified. [7]–[9] |
| Budget | Implemented on DB path; mock risk | Persistent reservations lock a task and compare aggregate usage against limits. MemoryGovernanceStores.reserveBudget() always returns true and is in-memory; ensure it stays test-only. [6] [7] |
| Kill switch / circuit breaker | Implemented; recovery proof incomplete | Mutating API requests are blocked when the interlock is set. Tenant-facing endpoints can only move to a safer state; release requires protected platform dual-control. This does not prove in-flight work is cancelled or that protected recovery is operational. [4] [10] |
| Audit integrity | Implemented and CI-checked; residual risk | DB triggers/chain head serialize appends; a dedicated verifier checks links and head; v2 hashes use domain separation and length framing. The runbook says historical v1 delimiter ambiguity remains. A hash chain is not alone an independent immutable anchor. [11]–[13] [20] |
| SSRF / egress | Implemented; whole-system egress under-tested | HTTPS, allowlist, private/local-address and resolved-DNS checks, redirect restrictions and response-size limits exist. Kubernetes still permits general TCP 443 egress and every outbound path has not had live adversarial testing. [21] [22] [23] |
| Secrets / TEE / MPC-style evidence | Verification code exists; real trust runtime unverified | Preflight checks keys, HTTPS and signed release-bound evidence. This verifies supplied evidence under configured keys; it does not prove actual secure-enclave measurement, independent verifier operation or deployed MPC computation. [24] [25] |
| Artifact storage | Incomplete/config mismatch | Preflight accepts STORAGE_DRIVER=s3, while createStorage() supports only local and throws for s3. GNW_SHARED_STORAGE_CONFIRMED is an assertion, not proof of shared RWX storage. [26] |
| GPU / precision agriculture | Modules exist; governed API wiring unproven | README advertises GPU/agriculture and source modules exist. The reviewed Fastify entrypoint does not register them as governed routes; README quick-start invokes the Python GPU pipeline independently. Compiled GPU endpoints in the ZIP do not prove they exist in current main or are wired through governed execution. [2] [3] [4] [27] [28] |
| Outbox | Module exists; worker wiring unverified | OutboxLedger uses FOR UPDATE SKIP LOCKED, but live worker/event-delivery evidence was not found. [29] |
| K8s / Terraform / container | Templates and CI validation; deployment unverified | K8s schema and Terraform validation ran, but deployment.yaml contains a replacement image-digest placeholder and configmap.yaml a replacement source SHA. Syntax validation is not live deployment, IAM, storage or rollback proof. [16] [30]–[32] |
| Independent review / certification | Explicitly blocked | Project documentation says NOT CERTIFIED, live integrations/E2E NOT TESTED and independent review NOT APPROVED. [14] |

## Release and test evidence

- **Positive:** main-branch CI, continuous security, compliance, CodeQL and Scorecard runs reported success. The image build/scan/publish workflow logged digest sha256:7bc63381012a60ee5709e78f8a1319b4b9cfe5741b872a7152fb6108d0de4800 and successful signing/provenance steps. [16] [17]
- **Blocking:** candidate certification run #38731098233 failed before dependency install; migrations, RLS suite, tests, mock harness, build, kill-switch drill and audit verification were skipped. [18]
- **Pending:** PR #84 moves npm ci before the guard. At cutoff it was open/unmerged. After merge, rerun candidate evidence on the exact merge SHA and inspect every step and artifact. [19]
- **Not proven:** live provider integrations, real executor isolation, production DB multi-instance behavior, deployed GPU/agriculture services, alert delivery, key rotation and independent review. The README itself distinguishes mocked-provider tests from live integration proof. [3] [14]

## Priority remediation before production claims

1. Bind archive hash, source commit, lockfile hash, build recipe, SBOM and OCI image digest in a signed release manifest; rebuild from a full source checkout rather than the source-less ZIP.
2. Review/merge PR #84, rerun candidate evidence on the exact merged SHA and ensure all gates execute.
3. Close the sessions RLS/test-scope question; expand cross-tenant tests using runtime credentials.
4. Identify and pin the executor receiver/image; verify HMAC, replay protection, command policy, resource/network isolation and in-flight cancellation with a disposable executor.
5. Implement/test S3 or reject it in production preflight; prove shared artifact storage across replicas.
6. Demonstrate kill-switch effects on queued/in-flight work and rehearse protected dual-control recovery.
7. Narrow and live-test outbound paths, including DNS-rebinding and redirect behavior.
8. Obtain timestamped evidence per real provider/tool, live E2E mission, backup/restore, alert/key-rotation drills and independent reviewer approval.
9. Do not advertise GPU/agriculture/outbox as integrated into governed task execution until routes/workers, tenant/auth policy, audit and acceptance tests prove the wiring.

## Scope and limitations

This is a read-only implementation audit; no deployment or live service test was attempted. It does not certify security, production readiness or compliance. The requested /home/ubuntu/skills/deep-research/SKILL.md was unavailable at the specified path in the active runtime; the connected Windows device mapped it to a non-existent Windows path, so this report does not claim that file was read.

The connected remote Windows workspace is a different repository, Asisyedj/Asisyedj-GNW-Governed-Agentic-AI. Its audit/source-import-2026-09-14 branch was five commits ahead and showed many deleted tracked dependency/build files plus untracked files. It was not reset or pushed and is not evidence about the audited target repository. Do not push that workspace as a shortcut to update GNW v4.

## References

[1] Repository metadata/default branch: https://github.com/Asisyedj/gnw-governed-agent-v4  
[2] Audited main commit: https://github.com/Asisyedj/gnw-governed-agent-v4/commit/a5e027416232d6b8b8219724e81792a6175093fb  
[3] README: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/README.md  
[4] Fastify app: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/src/server/app.ts  
[5] Auth routes: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/src/server/routes/auth.ts  
[6] Governance: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/src/server/governance.ts  
[7] Governed execution: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/src/server/execution.ts  
[8] Executor client: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/src/server/executor-client.ts  
[9] Database schema: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/src/server/db/schema.ts  
[10] Interlock route/guards: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/src/server/routes/interlock.ts ; https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/src/server/security/p1-guards.ts  
[11] RLS migrations and suite: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/drizzle/0001_production_rls.sql ; https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/drizzle/0002_governance_hardening.sql ; https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/scripts/test-rls-policy-suite.mjs  
[12] Audit hash chain migration: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/drizzle/0003_audit_hash_chain.sql  
[13] Audit verifier and v2 framing: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/drizzle/0004_audit_verifier_hardening.sql ; https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/drizzle/0005_audit_chain_v2_framing.sql ; https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/docs/runbook-audit-chain.md  
[14] Certification decision: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/docs/PRODUCTION_CERTIFICATION.md  
[15] Current candidate workflow: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/.github/workflows/gnw-release-certification.yml  
[16] Main CI run: https://github.com/Asisyedj/gnw-governed-agent-v4/actions/runs/38718731728  
[17] Image publication/signing run: https://github.com/Asisyedj/gnw-governed-agent-v4/actions/runs/38718731740  
[18] Failed certification-evidence run: https://github.com/Asisyedj/gnw-governed-agent-v4/actions/runs/38731098233  
[19] PR #84: https://github.com/Asisyedj/gnw-governed-agent-v4/pull/84  
[20] Audit-chain verifier: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/scripts/verify-audit-chain.mjs  
[21] Egress controls: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/src/server/security.ts  
[22] SSRF helpers: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/src/server/lib/ssrf.ts  
[23] Kubernetes network policy: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/k8s/networkpolicy.yaml  
[24] Production preflight: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/scripts/preflight-production.mjs  
[25] Example environment template: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/.env.example  
[26] Artifact storage: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/src/server/storage.ts  
[27] GPU pipeline: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/pipelines/gpu/gpu_mesh_orchestrator.py  
[28] Agricultural orchestration: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/src/orchestration/agriculturalOrchestration.ts  
[29] Outbox: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/src/server/outbox/OutboxLedger.ts  
[30] Kubernetes deployment: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/k8s/deployment.yaml  
[31] Terraform: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/infra/terraform/main.tf  
[32] Container release workflow: https://github.com/Asisyedj/gnw-governed-agent-v4/blob/main/.github/workflows/release-container.yml
